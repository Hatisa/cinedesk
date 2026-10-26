/**
 * 离线缓存任务队列。
 *
 * 集与集之间**串行**执行，同一时刻只下一集。
 *
 * 下载引擎内部已对分片做了并发（默认 4 路），若再多集并行，会对同一个
 * 源站瞬间发出十几路请求：既容易被限流，也会让每一集的进度都变得极慢，
 * 用户看到的是「十集全都卡在 3%」。逐个缓存既稳又容易看懂进度——
 * 主流视频 App 也是这个做法，只是把队列做得让用户无感。
 *
 * 队列本身是纯逻辑，真正要执行的动作由 run 注入，因此「串行、取消、
 * 失败不阻塞后续」这些行为可以被测试锁定。
 */

export type TaskStatus = 'waiting' | 'running' | 'done' | 'failed' | 'cancelled';

export interface QueueTask<T> {
  id: string;
  status: TaskStatus;
  /** 已完成分片数 */
  done: number;
  /** 总分片数；0 表示播放列表还没解析出来 */
  total: number;
  bytes: number;
  /** 平均下载速度（字节/秒），用于界面显示「1.2 MB/s」 */
  speed: number;
  error?: string;
  payload: T;
}

export interface QueueOptions<T> {
  /** 执行一个任务；progress 用于回报进度，signal 用于取消 */
  run: (
    payload: T,
    progress: (done: number, total: number, bytes: number, speed: number) => void,
    signal: AbortSignal,
  ) => Promise<void>;
  /** 任务列表变化后的回调，用于同步到界面 */
  onChange?: (tasks: QueueTask<T>[]) => void;
}

export class TaskQueue<T> {
  private list: QueueTask<T>[] = [];
  private controllers = new Map<string, AbortController>();
  private working = false;
  private opts: QueueOptions<T>;

  constructor(opts: QueueOptions<T>) {
    this.opts = opts;
  }

  /** 当前全部任务（含已结束的，便于界面展示与清理） */
  snapshot(): QueueTask<T>[] {
    return this.list;
  }

  find(id: string): QueueTask<T> | undefined {
    return this.list.find((t) => t.id === id);
  }

  /** 是否已在这个队列里（等待中或进行中） */
  has(id: string): boolean {
    const t = this.find(id);
    return !!t && (t.status === 'waiting' || t.status === 'running');
  }

  /**
   * 入队。
   * 同一 id 已在队列里则忽略；已结束的旧记录会被换成新的等待任务
   * （失败重试、取消后续传走的都是这条路径）。
   */
  add(id: string, payload: T): void {
    if (this.has(id)) return;
    this.list = [
      ...this.list.filter((t) => t.id !== id),
      { id, payload, status: 'waiting', done: 0, total: 0, bytes: 0, speed: 0 },
    ];
    this.emit();
    void this.pump();
  }

  /**
   * 取消一个任务。
   * 已经在下载的会被 abort（分片文件保留，续传时自动跳过）；
   * 等待中的直接标记取消，轮到它时不再执行。
   */
  cancel(id: string): void {
    const t = this.find(id);
    if (!t) return;
    if (t.status === 'running') {
      this.controllers.get(id)?.abort();
      this.update(id, { status: 'cancelled' });
    } else if (t.status === 'waiting') {
      this.update(id, { status: 'cancelled' });
    }
  }

  /** 移除一条已结束的记录（取消的任务也在这里清掉） */
  remove(id: string): void {
    const t = this.find(id);
    if (!t || t.status === 'waiting' || t.status === 'running') return;
    this.list = this.list.filter((x) => x.id !== id);
    this.emit();
  }

  private update(id: string, patch: Partial<QueueTask<T>>): void {
    this.list = this.list.map((t) => (t.id === id ? { ...t, ...patch } : t));
    this.emit();
  }

  private emit(): void {
    this.opts.onChange?.(this.list);
  }

  /** 依次执行等待中的任务；同一时刻只有一个在跑 */
  private async pump(): Promise<void> {
    if (this.working) return;
    this.working = true;
    try {
      for (;;) {
        const next = this.list.find((t) => t.status === 'waiting');
        if (!next) break;
        await this.runOne(next);
      }
    } finally {
      this.working = false;
    }
  }

  private async runOne(task: QueueTask<T>): Promise<void> {
    const { id, payload } = task;
    // 排队期间被取消：直接跳过，不占用一次执行
    if (this.find(id)?.status !== 'waiting') return;

    const ctrl = new AbortController();
    this.controllers.set(id, ctrl);
    this.update(id, { status: 'running' });

    try {
      await this.opts.run(
        payload,
        (done, total, bytes, speed) => {
          // 取消后迟到的进度回调丢弃，否则界面上会「取消完又跳一下」
          if (this.find(id)?.status !== 'running') return;
          this.update(id, { done, total, bytes, speed });
        },
        ctrl.signal,
      );
      // run 正常返回但期间被取消：保持取消状态，不覆盖成完成
      if (this.find(id)?.status !== 'cancelled') {
        this.update(id, { status: 'done' });
      }
    } catch (e) {
      const name = e instanceof Error ? e.name : '';
      const msg = e instanceof Error ? e.message : String(e);
      if (this.find(id)?.status === 'cancelled' || name === 'AbortError') {
        this.update(id, { status: 'cancelled' });
      } else {
        // 单集失败不中断队列：后面的集继续下，用户只需重试失败的那集
        this.update(id, { status: 'failed', error: msg });
      }
    } finally {
      this.controllers.delete(id);
    }
  }
}
