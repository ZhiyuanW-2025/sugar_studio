begin;

insert into public.projects (
  id,
  name,
  description,
  status
)
values (
  '7e71a61e-6804-4fb4-9f5e-0f80d6950001',
  '梧桐无同',
  '以上海梧桐区街区探索为核心的城市游戏项目。',
  'production_preparation'
)
on conflict (id) do nothing;

insert into public.project_snapshots (
  id,
  project_id,
  summary,
  current_plan_summary,
  current_stage
)
values (
  '7e71a61e-6804-4fb4-9f5e-0f80d6950101',
  '7e71a61e-6804-4fb4-9f5e-0f80d6950001',
  '终点奖励为拍立得与餐食；AI 插画流程已取消。',
  'Moon Moi 调整为单步视觉匹配，其他点位保持不变。',
  '制作准备'
)
on conflict (id) do nothing;

commit;
