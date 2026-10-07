import { useEffect } from 'react';
import type { Locale } from '../../i18n/messages';
import { useAppStore } from '../../state/appStore';
import { ModePanel } from '../controls/ModePanel';
import { clampSunlineTime } from './solar';
import styles from './SunlineControls.module.css';

const COPY = {
  zh: {
    title: '移动太阳时间',
    date: 'UTC 日期',
    time: 'UTC 时间',
    play: '播放一天',
    pause: '暂停',
    now: '回到此刻',
    live: '实时',
    fixed: '固定时间',
    speed: '1440× · 约 60 秒 / 天',
    note: 'NOAA/Meeus 近似值，仅供教育参考；曙暮光指太阳高度在 0° 至 -6° 之间。',
    expand: '展开日照线控件',
    collapse: '收起日照线控件',
  },
  en: {
    title: 'Move solar time',
    date: 'UTC date',
    time: 'UTC time',
    play: 'Play one day',
    pause: 'Pause',
    now: 'Return to now',
    live: 'Live',
    fixed: 'Fixed time',
    speed: '1440× · about 60 seconds / day',
    note: 'NOAA/Meeus approximations, for education only; twilight means the Sun is between 0° and -6°.',
    expand: 'Expand Sunline controls',
    collapse: 'Collapse Sunline controls',
  },
} as const;

export function SunlineControls({ locale }: { locale: Locale }) {
  const timeMs = useAppStore((state) => state.sunlineTimeMs);
  const clockMode = useAppStore((state) => state.sunlineClockMode);
  const playing = useAppStore((state) => state.sunlinePlaying);
  const selectTime = useAppStore((state) => state.selectSunlineTime);
  const advanceTime = useAppStore((state) => state.advanceSunlineTime);
  const syncLiveTime = useAppStore((state) => state.syncSunlineLiveTime);
  const setPlaying = useAppStore((state) => state.setSunlinePlaying);
  const returnToLive = useAppStore((state) => state.returnSunlineToLive);
  const copy = COPY[locale];
  const date = new Date(timeMs);
  const dateValue = date.toISOString().slice(0, 10);
  const minuteOfDay = date.getUTCHours() * 60 + date.getUTCMinutes();
  const timeLabel = `${String(date.getUTCHours()).padStart(2, '0')}:${String(
    date.getUTCMinutes(),
  ).padStart(2, '0')} UTC`;

  useEffect(() => {
    if (clockMode !== 'live') return;
    syncLiveTime();
    const timer = window.setInterval(() => syncLiveTime(), 1000);
    return () => window.clearInterval(timer);
  }, [clockMode, syncLiveTime]);

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let previous = performance.now();
    let accumulated = 0;
    let lastCommit = previous;
    const tick = (now: number) => {
      accumulated += Math.min(now - previous, 500);
      previous = now;
      if (now - lastCommit >= 100) {
        advanceTime(accumulated);
        accumulated = 0;
        lastCommit = now;
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [advanceTime, playing]);

  function updateDate(value: string) {
    const parts = value.split('-').map(Number);
    const [year, month, day] = parts;
    if (!year || !month || !day) return;
    selectTime(
      Date.UTC(year, month - 1, day, date.getUTCHours(), date.getUTCMinutes()),
    );
  }

  function updateMinute(minute: number) {
    selectTime(
      clampSunlineTime(
        Date.UTC(
          date.getUTCFullYear(),
          date.getUTCMonth(),
          date.getUTCDate(),
          Math.floor(minute / 60),
          minute % 60,
        ),
      ),
    );
  }

  return (
    <ModePanel
      id="sunline-controls"
      title={copy.title}
      subtitle={`${clockMode === 'live' ? copy.live : copy.fixed} · ${copy.speed}`}
      expandLabel={copy.expand}
      collapseLabel={copy.collapse}
    >
      <>
        <div className={styles.primaryControls}>
          <label>
            <span>{copy.date}</span>
            <input
              type="date"
              min="2000-01-01"
              max="2099-12-31"
              value={dateValue}
              onChange={(event) => updateDate(event.target.value)}
            />
          </label>
          <div className={styles.actions}>
            <button type="button" onClick={() => setPlaying(!playing)}>
              {playing ? copy.pause : copy.play}
            </button>
            <button type="button" onClick={() => returnToLive()}>
              {copy.now}
            </button>
          </div>
        </div>

        <label className={styles.timeline}>
          <span>{copy.time}</span>
          <strong>{timeLabel}</strong>
          <input
            type="range"
            min="0"
            max="1439"
            step="1"
            value={minuteOfDay}
            onChange={(event) => updateMinute(Number(event.target.value))}
          />
        </label>

        <p className={styles.note}>{copy.note}</p>
      </>
    </ModePanel>
  );
}
