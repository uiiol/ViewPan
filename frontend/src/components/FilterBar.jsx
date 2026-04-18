import { Select, Space } from "antd";
import TimeGranularityPicker from "./TimeGranularityPicker";

const FULL_PERIOD_OPTIONS = [
  { label: "全年", value: "full-year" },
  { label: "Q1（1-3月）", value: "Q1" },
  { label: "Q2（4-6月）", value: "Q2" },
  { label: "Q3（7-9月）", value: "Q3" },
  { label: "Q4（10-12月）", value: "Q4" },
  { label: "上半年（1-6月）", value: "first-half" },
  { label: "下半年（7-12月）", value: "second-half" },
  { label: "自定义", value: "custom" },
];

function buildMonthOptions(availableMonths, year) {
  const all = Array.from({ length: 12 }, (_, i) => i + 1);
  const available = new Set(availableMonths || all);
  return all.map(m => ({
    label: `${m}月`,
    value: `month-${m}`,
    disabled: !available.has(m),
  }));
}

export default function FilterBar({
  years, selectedYear, onYearChange,
  selectedPeriod, onPeriodChange,
  channels, selectedChannel, onChannelChange,
  companies, selectedCompany, onCompanyChange,
  showCompany = false,
  availableMonths = [],
  customStart, customEnd, onCustomRangeChange,
  style,
  // TimeGranularityPicker integration
  timeRange, onTimeRangeChange,
}) {
  const periodOptions = [
    ...FULL_PERIOD_OPTIONS,
    { type: "divider" },
    ...buildMonthOptions(availableMonths, selectedYear),
  ];

  const isCustom = selectedPeriod === "custom";

  return (
    <Space wrap size={[6, 6]} style={{ display: "flex", flexWrap: "wrap", ...style }}>
      {timeRange !== undefined ? (
        <TimeGranularityPicker
          value={timeRange}
          onChange={onTimeRangeChange}
          defaultGranularity="month"
        />
      ) : (
        <>
          <Select
            style={{ width: 90 }}
            value={selectedYear}
            onChange={y => { onYearChange(y); onPeriodChange("full-year"); }}
            options={years.map(y => ({ label: `${y}年`, value: y }))}
          />
          <Select
            style={{ width: 130 }}
            value={selectedPeriod}
            onChange={p => { onPeriodChange(p); }}
            options={periodOptions}
            optionRender={opt => {
              if (opt.type === "divider") return <span style={{ color: "#d9d9d9" }}>---</span>;
              const disabled = opt.disabled;
              return <span style={{ color: disabled ? "#bfbfbf" : undefined }}>{opt.label}</span>;
            }}
          />
          {isCustom && (
            <>
              <Select
                style={{ width: 80 }}
                placeholder="起始月"
                value={customStart}
                onChange={v => onCustomRangeChange(v, customEnd)}
                options={availableMonths.map(m => ({ label: `${m}月`, value: m }))}
              />
              <span style={{ color: "#888" }}>至</span>
              <Select
                style={{ width: 80 }}
                placeholder="结束月"
                value={customEnd}
                onChange={v => onCustomRangeChange(customStart, v)}
                options={availableMonths.filter(m => !customStart || m >= customStart).map(m => ({ label: `${m}月`, value: m }))}
              />
            </>
          )}
        </>
      )}
      <Select
        style={{ width: 200 }}
        placeholder="全部渠道商"
        allowClear
        showSearch
        filterOption={(input, opt) => opt.label.includes(input)}
        value={selectedChannel}
        onChange={v => { onChannelChange(v); if (!v && onCompanyChange) onCompanyChange(null); }}
        options={channels.map(c => ({ label: c.name, value: c.name }))}
        onClear={() => { onChannelChange(null); if (onCompanyChange) onCompanyChange(null); }}
      />
      {showCompany && (
        <Select
          style={{ width: 180 }}
          placeholder="全部客户"
          allowClear
          showSearch
          filterOption={(input, opt) => opt.label.includes(input)}
          value={selectedCompany}
          onChange={onCompanyChange}
          onOpenChange={open => {
            if (open) onCompanyChange && onCompanyChange(selectedCompany);
          }}
          options={(companies || []).map(c => ({ label: c.name, value: c.id }))}
        />
      )}
    </Space>
  );
}
