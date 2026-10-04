'use client';

import React, { useEffect, useState } from 'react';

import { PillGroup } from './ui/Pills';

interface WeekdaySelectorProps {
  onWeekdayChange: (weekday: string) => void;
}

const weekdays = [
  { value: 'Mon', label: '周一' },
  { value: 'Tue', label: '周二' },
  { value: 'Wed', label: '周三' },
  { value: 'Thu', label: '周四' },
  { value: 'Fri', label: '周五' },
  { value: 'Sat', label: '周六' },
  { value: 'Sun', label: '周日' },
];

// getDay() 返回 0-6，0 是周日
const getTodayWeekday = () =>
  ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date().getDay()];

/** 星期选择（默认今天），用于 Bangumi 每日放送 */
const WeekdaySelector: React.FC<WeekdaySelectorProps> = ({
  onWeekdayChange,
}) => {
  const [selectedWeekday, setSelectedWeekday] = useState(getTodayWeekday);

  // 初始化时通知父组件默认选中的星期
  useEffect(() => {
    onWeekdayChange(getTodayWeekday());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <PillGroup
      options={weekdays}
      value={selectedWeekday}
      onChange={(value) => {
        setSelectedWeekday(value);
        onWeekdayChange(value);
      }}
    />
  );
};

export default WeekdaySelector;
