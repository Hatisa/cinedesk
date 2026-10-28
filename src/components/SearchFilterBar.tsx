import { useState } from 'react';
import { EMPTY_SEARCH_FILTERS, SEARCH_AREAS, SEARCH_TYPES, isSearchFiltersEmpty, searchYearOptions, type SearchFilters } from '../core';

interface Props {
  value: SearchFilters;
  onChange: (next: SearchFilters) => void;
  filtered: number;
  total: number;
}

/** 参考片库的分类行，默认收起以保留移动端结果浏览空间。 */
export default function SearchFilterBar({ value, onChange, filtered, total }: Props) {
  const [expanded, setExpanded] = useState(false);
  const active = !isSearchFiltersEmpty(value);
  const selected = [value.type, value.area, yearLabel(value.year)].filter(Boolean).join(' · ');
  const reset = () => onChange({ ...EMPTY_SEARCH_FILTERS });
  const groups: { key: keyof SearchFilters; label: string; options: { value: string; label: string }[] }[] = [
    { key: 'type', label: '类型', options: SEARCH_TYPES.map((type) => ({ value: type, label: type })) },
    { key: 'area', label: '地区', options: SEARCH_AREAS.map((area) => ({ value: area, label: area })) },
    { key: 'year', label: '时间', options: [
      { value: 'upcoming', label: '即将上映' },
      ...searchYearOptions().map((year) => ({ value: year, label: year })),
      { value: 'older', label: `${new Date().getFullYear() - 6}及以前` },
    ] },
  ];

  return (
    <section className={`search-filter${expanded ? ' expanded' : ''}`} aria-label="筛选搜索结果">
      <div className="filter-summary">
        <button className="filter-toggle" type="button" aria-expanded={expanded} aria-controls="search-filter-options" onClick={() => setExpanded((v) => !v)}>
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
          <span>筛选</span>
          <span className={`filter-summary-value${active ? ' active' : ''}`}>{selected || '全部影片'}</span>
          <svg className="filter-chevron" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="m7 10 5 5 5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <span className="filter-count">{active ? `${filtered} / ${total}` : total} 部</span>
      </div>
      {expanded && (
        <div className="filter-options" id="search-filter-options">
          {groups.map((group) => (
            <div className="filter-row" role="group" aria-label={`按${group.label}筛选`} key={group.key}>
              <span className="filter-label">{group.label}</span>
              <div className="filter-values">
                <button className={`filter-option${value[group.key] === '' ? ' active' : ''}`} type="button" aria-pressed={value[group.key] === ''} onClick={() => onChange({ ...value, [group.key]: '' })}>全部</button>
                {group.options.map((option) => (
                  <button className={`filter-option${value[group.key] === option.value ? ' active' : ''}`} type="button" aria-pressed={value[group.key] === option.value} key={option.value} onClick={() => onChange({ ...value, [group.key]: option.value })}>{option.label}</button>
                ))}
              </div>
            </div>
          ))}
          {active && <button className="filter-reset" type="button" onClick={reset}>清除全部筛选</button>}
        </div>
      )}
    </section>
  );
}

function yearLabel(year: string): string {
  if (year === 'upcoming') return '即将上映';
  if (year === 'older') return `${new Date().getFullYear() - 6}及以前`;
  return year;
}
