#!/usr/bin/env bash
# Netlify 部署時由環境變數產生 config.js（本機仍用 config.js，不進 git）
set -euo pipefail

: "${SUPABASE_URL:?Set SUPABASE_URL in Netlify env vars}"
: "${SUPABASE_ANON_KEY:?Set SUPABASE_ANON_KEY in Netlify env vars}"

cat > config.js <<EOF
window.SUPABASE_URL = "${SUPABASE_URL}";
window.SUPABASE_ANON_KEY = "${SUPABASE_ANON_KEY}";
window.SUPABASE_TABLE = "iphone_prices";
window.SUPABASE_STATS_TABLE = "daily_run_stats";
window.SUPABASE_SENDER_STATS_TABLE = "sender_daily_stats";
window.SUPABASE_PENDING_TABLE = "pending_quotes";
window.SUPABASE_TICKS_TABLE = "quote_ticks";
window.SUPABASE_MSRP_TABLE = "product_msrp";
window.SUPABASE_BUY_DEMAND_TABLE = "buy_demand_ticks";
window.SUPABASE_BUY_DEMAND_PENDING_TABLE = "buy_demand_pending";
EOF

echo "config.js generated for Netlify deploy"
