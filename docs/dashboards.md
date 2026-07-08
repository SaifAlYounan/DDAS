# Metrics & dashboards

`GET /metrics` exposes Prometheus metrics: the standard `process_*`/`nodejs_*`
set plus the DDAS counters below. Scrape it with any Prometheus-compatible
collector; every metric is a monotonic counter unless noted.

| Metric | Labels | Meaning |
|---|---|---|
| `ddas_requests_total` | — | Authority requests submitted (REST + MCP) |
| `ddas_classifications_total` | `status` = `ROUTED` \| `INCOMPLETE` | Classification results |
| `ddas_decisions_total` | `outcome` = `approved` \| `rejected` \| `auto_approved` | Final decisions |
| `ddas_extraction_runs_total` | `outcome` = `completed` \| `failed` | LLM extraction job outcomes (per attempt) |
| `ddas_webhook_deliveries_total` | `outcome` = `delivered` \| `retrying` \| `dead` | Webhook delivery attempts |
| `ddas_mcp_calls_total` | `tool` | MCP tool invocations |

## Useful queries

```promql
# Decision throughput by outcome, 5m rate
sum by (outcome) (rate(ddas_decisions_total[5m]))

# INCOMPLETE ratio — rising = your policy demands facts extraction can't find
sum(rate(ddas_classifications_total{status="INCOMPLETE"}[1h]))
  / sum(rate(ddas_classifications_total[1h]))

# Extraction failure ratio (alert > 0.2 for 15m)
sum(rate(ddas_extraction_runs_total{outcome="failed"}[15m]))
  / sum(rate(ddas_extraction_runs_total[15m]))

# Webhook health — dead deliveries should be zero
increase(ddas_webhook_deliveries_total{outcome="dead"}[1h])

# Agent activity over MCP
sum by (tool) (rate(ddas_mcp_calls_total[1h]))
```

Operational signals worth alerting on beyond `/metrics`:
- `POST /api/v1/audit/verify` returning `ok: false` (run it on a schedule).
- `needs_info` rates per category from simulation summaries — a policy-review
  signal, never auto-adjusted.
