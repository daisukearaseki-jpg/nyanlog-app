-- にゃんログ用 ケア記録テーブル
-- Supabase ダッシュボードの SQL Editor で実行してください

create table if not exists records (
  id uuid default gen_random_uuid() primary key,
  care_id text not null,
  timestamp bigint not null,
  memo text default '',
  large_syringe int default 0,
  small_syringe int default 0,
  created_at timestamptz default now()
);

-- 誰でも読み取り・挿入・削除可能（家族共有アプリ用）
alter table records enable row level security;

create policy "Allow all read" on records for select using (true);
create policy "Allow all insert" on records for insert with check (true);
create policy "Allow all delete" on records for delete using (true);

-- インデックス（timestampでソートするため）
create index if not exists idx_records_timestamp on records (timestamp desc);
