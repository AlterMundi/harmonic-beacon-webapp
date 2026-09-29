// @vitest-environment jsdom
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { EventResults, deltaPercent, finiteMetric, TrendChart, RankedBars } from '../AnalyticsVisuals';
afterEach(cleanup);
describe('analytics chart semantics',()=>{
 it('compares original units and keeps missing/zero baselines distinct',()=>{
  expect(deltaPercent(7200,3600)).toBe(100);
  expect(deltaPercent(0,3600)).toBe(-100);
  expect(deltaPercent(3600,0)).toBeNull();
  expect(deltaPercent(null,3600)).toBeNull();
  expect(finiteMetric(null)).toBeNull();
  expect(finiteMetric('0')).toBe(0);
 });
 it('keeps missing days as gaps and provides accessible daily values',()=>{
  const {container}=render(<TrendChart title="Listening" unit="hours" divisor={3600} metric="listening_seconds" rows={[
   {metric_date:'2026-09-01',listening_seconds:3600},
   {metric_date:'2026-09-03',listening_seconds:7200},
  ]}/>);
  expect(screen.getByRole('img')).toHaveAccessibleName(/2 observed days/);
  expect(screen.getByText('Daily values')).toBeInTheDocument();
  expect(container.querySelectorAll('circle')).toHaveLength(2);
  expect(container.querySelectorAll('line[stroke="var(--lime)"]')).toHaveLength(0);
  expect(screen.getByRole('cell',{name:'2'})).toBeInTheDocument();
 });
 it('does not turn unknown measurements into zero-valued rankings',()=>{
  render(<RankedBars rows={[{label:'Missing',value:null},{label:'Zero',value:0}]} labelKey="label" valueKey="value"/>);
  expect(screen.queryByText('Missing')).not.toBeInTheDocument();
  expect(screen.getByText('Zero')).toBeInTheDocument();
 });
});

it('switches event outcomes without confusing participant-hours with average minutes',()=>{
 render(<EventResults timezone="UTC" rows={[
  {event_subject:'older',first_entry:'2026-09-01T13:00:00Z',attendees:4,attendee_seconds:7200,reconnects:2},
  {event_subject:'newer',first_entry:'2026-09-02T13:00:00Z',attendees:2,attendee_seconds:7200,reconnects:0},
 ]}/>);
 expect(screen.getByRole('combobox',{name:'Event'})).toHaveValue('newer');
 expect(screen.getByText('60')).toBeInTheDocument();
 fireEvent.change(screen.getByRole('combobox'),{target:{value:'older'}});
 expect(screen.getByText('30')).toBeInTheDocument();
 expect(screen.getByText(/not confirmed crashes/)).toBeInTheDocument();
});

it('keeps the panel renderable while an invalid timezone is being rejected by the API',()=>{
 const {rerender}=render(<EventResults timezone="UTC" rows={[{event_subject:'event',first_entry:'2026-09-01T13:00:00Z',attendees:2,attendee_seconds:7200}]}/>);
 expect(()=>rerender(<EventResults timezone="Mars/Olympus" rows={[{event_subject:'event',first_entry:'2026-09-01T13:00:00Z',attendees:2,attendee_seconds:7200}]}/>)).not.toThrow();
 expect(screen.getByRole('option')).toHaveTextContent('Unknown date');
});
