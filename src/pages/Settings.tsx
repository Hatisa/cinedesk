import { useState } from 'react';
import { useToast } from '../components/Toast';
import { buildApiUrl, httpGetJson, probeSources, type SourceConfig, type SourceStatus } from '../core';
import { useApp } from '../state/AppState';

/** 从接口地址推导一个稳定的源标识 */
function keyFromUrl(api: string): string {
  try {
    const u = new URL(api);
    return u.hostname.replace(/^www\./, '').replace(/[^a-z0-9]/gi, '_').toLowerCase();
  } catch {
    return `custom_${Date.now().toString(36)}`;
  }
}

export default function Settings() {
  const toast = useToast();
  const {
    sources,
    health,
    settings,
    updateSource,
    addSource,
    removeSource,
    resetSources,
    setSettings,
    persistHealth,
    resetHealth,
    ready,
  } = useApp();

  const [probing, setProbing] = useState(false);
  const [probeResult, setProbeResult] = useState<Record<string, SourceStatus>>({});
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', api: '' });
  /** 添加中的协议预检，防止重复提交 */
  const [adding, setAdding] = useState(false);

  const enabledCount = sources.filter((s) => s.enabled).length;

  const runProbe = async () => {
    setProbing(true);
    setProbeResult({});
    const res = await probeSources(sources.filter((s) => s.enabled), {
      health,
      timeoutMs: 9000,
      onStatus: (st) => setProbeResult((prev) => ({ ...prev, [st.key]: st })),
    });
    persistHealth();
    setProbing(false);
    const ok = res.filter((r) => r.state === 'ok' || r.state === 'empty').length;
    toast(`测速完成：${ok}/${res.length} 个源可用`);
  };

  const submitAdd = async () => {
    const name = form.name.trim();
    const api = form.api.trim();
    if (!name) {
      toast('请填写名称');
      return;
    }
    if (!/^https?:\/\//i.test(api)) {
      toast('接口地址需以 http:// 或 https:// 开头');
      return;
    }
    const key = keyFromUrl(api);
    /*
     * 除 key（域名）外再按归一化地址判重：同一接口填不同名称仍是同一个源，
     * 混进来只会重复请求、在结果里产生重复线路。
     */
    const norm = (u: string) => u.trim().replace(/\/+$/, '').toLowerCase();
    if (sources.some((s) => s.key === key || norm(s.api) === norm(api))) {
      toast('该源已存在（相同域名或相同接口地址）');
      return;
    }
    /*
     * 协议预检：用 ac=list 试探一次。这里放过 https://baidu.com 这类非 CMS
     * 地址的话，用户只会在测速里看到一句「timeout」，完全猜不到是地址错了。
     * 提前问一次接口，当场给出明确原因。
     */
    setAdding(true);
    try {
      const { json } = await httpGetJson<Record<string, unknown>>(buildApiUrl(api, { ac: 'list' }), 8000);
      const looksLikeCms =
        !!json && typeof json === 'object' && ('list' in json || 'code' in json);
      if (!looksLikeCms) {
        toast('该接口不是苹果 CMS（vod）协议，地址应形如 /api.php/provide/vod');
        return;
      }
    } catch {
      toast('无法访问该接口，请检查地址与网络');
      return;
    } finally {
      setAdding(false);
    }
    addSource({ key, name, api, enabled: true } as SourceConfig);
    setForm({ name: '', api: '' });
    setShowAdd(false);
    toast(`已添加「${name}」`);
    void runProbe();
  };

  const autoDisable = () => {
    // 连续失败 3 次以上视为长期不可用，自动停用避免每次搜索白等
    const dead = sources.filter((s) => s.enabled && health.get(s.key).failStreak >= 3);
    if (!dead.length) {
      toast('没有需要停用的源');
      return;
    }
    for (const s of dead) updateSource(s.key, { enabled: false });
    toast(`已停用 ${dead.length} 个持续失败的源`);
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">设置</h1>
      </div>

      <div className="group-title">资源源（{enabledCount}/{sources.length} 启用）</div>
      <div className="btn-row" style={{ marginBottom: 10 }}>
        <button className="btn" onClick={() => void runProbe()} disabled={probing || !ready}>
          {probing ? '测速中…' : '全部测速'}
        </button>
        <button className="btn" onClick={() => setShowAdd(true)}>
          添加源
        </button>
      </div>

      <div className="list" style={{ marginBottom: 18 }}>
        {sources.map((s) => {
          const rec = health.get(s.key);
          const probe = probeResult[s.key];
          const dot = probe
            ? probe.state === 'fail'
              ? 'fail'
              : 'ok'
            : rec.okTotal + rec.failTotal === 0
              ? 'idle'
              : rec.lastFail > rec.lastOk
                ? 'fail'
                : 'ok';
          const rate =
            rec.okTotal + rec.failTotal > 0
              ? Math.round((rec.okTotal / (rec.okTotal + rec.failTotal)) * 100)
              : null;
          return (
            <div className="list-row" key={s.key}>
              <span className={`status-dot ${dot}`} />
              <div className="list-body">
                <div className="list-title">{s.name}</div>
                <div className="list-desc" title={s.api}>
                  {probe
                    ? probe.state === 'loading'
                      ? '测速中…'
                      : probe.state === 'fail'
                        ? `测速失败：${probe.error}`
                        : `可用 · ${probe.ms}ms`
                    : [
                        rec.avgMs ? `${Math.round(rec.avgMs)}ms` : null,
                        rate !== null ? `成功率 ${rate}%` : null,
                        s.builtin ? '内置' : '自定义',
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                </div>
              </div>
              <button
                className={`switch${s.enabled ? ' on' : ''}`}
                onClick={() => updateSource(s.key, { enabled: !s.enabled })}
                aria-label={s.enabled ? '停用' : '启用'}
              />
              {!s.builtin && (
                <button className="row-action" onClick={() => removeSource(s.key)}>
                  删除
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="group-title">搜索与播放</div>
      <div className="group">
        <div className="setting-row">
          <div className="setting-label">
            <div className="t">请求超时</div>
            <div className="d">单个源等待上限，越短搜得越快但可能漏掉慢源</div>
          </div>
          <select
            value={settings.timeoutMs}
            onChange={(e) => setSettings({ timeoutMs: Number(e.target.value) })}
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--line)',
              borderRadius: 8,
              color: 'var(--text)',
              padding: '7px 9px',
            }}
          >
            <option value={6000}>6 秒</option>
            <option value={8000}>8 秒</option>
            <option value={12000}>12 秒</option>
            <option value={20000}>20 秒</option>
          </select>
        </div>
        <div className="setting-row">
          <div className="setting-label">
            <div className="t">记录观看进度</div>
            <div className="d">在「我的」里续播上次看到的位置</div>
          </div>
          <button
            className={`switch${settings.recordHistory ? ' on' : ''}`}
            onClick={() => setSettings({ recordHistory: !settings.recordHistory })}
            aria-label="记录观看进度"
          />
        </div>
        <div className="setting-row">
          <div className="setting-label">
            <div className="t">一键停用失效源</div>
            <div className="d">停用连续失败 3 次以上的源</div>
          </div>
          <button className="row-action" onClick={autoDisable}>
            执行
          </button>
        </div>
      </div>

      <div className="group-title">维护</div>
      <div className="group">
        <div className="setting-row">
          <div className="setting-label">
            <div className="t">重置源列表</div>
            <div className="d">恢复到 App 内置的初始源列表与排名</div>
          </div>
          <button
            className="row-action"
            onClick={() => {
              resetSources();
              resetHealth();
              setProbeResult({});
              toast('已重置为内置源');
            }}
          >
            重置
          </button>
        </div>
        <div className="setting-row">
          <div className="setting-label">
            <div className="t">清空健康度记录</div>
            <div className="d">让所有源回到同一起跑线重新排名</div>
          </div>
          <button
            className="row-action"
            onClick={() => {
              resetHealth();
              setProbeResult({});
              toast('健康度记录已清空');
            }}
          >
            清空
          </button>
        </div>
      </div>

      <div className="hint">
        影视大全不提供任何影视资源，仅聚合公开的采集接口用于检索。
        <br />
        所有搜索与播放都在你的设备上直接完成，没有服务器中转，不收集任何个人信息。
      </div>

      {showAdd && (
        <div className="modal-mask" onClick={() => setShowAdd(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>添加资源源</h3>
            <div className="page-sub">支持苹果 CMS（MacCMS）vod 协议的采集接口</div>
            <div className="field">
              <label>名称</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="例如 我的资源站"
              />
            </div>
            <div className="field">
              <label>接口地址</label>
              <input
                value={form.api}
                onChange={(e) => setForm({ ...form, api: e.target.value })}
                placeholder="https://example.com/api.php/provide/vod"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={() => setShowAdd(false)}>
                取消
              </button>
              <button className="btn primary" disabled={adding} onClick={() => void submitAdd()}>
                {adding ? '验证中…' : '添加'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
