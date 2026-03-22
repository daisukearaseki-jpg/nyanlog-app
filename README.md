# にゃんログ 🐱

老猫ケア記録アプリ。Supabaseでデータを共有し、複数ユーザーで同じ記録を蓄積できます。

## セットアップ

### 1. Supabaseプロジェクト作成

1. [Supabase](https://supabase.com) にサインアップ/ログイン
2. 新規プロジェクトを作成
3. **Settings** → **API** で以下を確認:
   - Project URL
   - anon public key

### 2. テーブル作成

Supabaseダッシュボードの **SQL Editor** で以下を実行:

```sql
-- supabase/migrations/001_create_records.sql の内容をコピーして実行
```

### 3. 環境変数

ローカル開発: プロジェクト直下に `.env` を作成:

```
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

Vercel: **Project Settings** → **Environment Variables** で上記2つを追加

### 4. 起動

```bash
npm install
npm run dev
```

## デプロイ

VercelはGitHub連携済み。環境変数を設定すれば自動デプロイされます。
