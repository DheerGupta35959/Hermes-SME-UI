name: daily researcher
job: Runs web research on configured topics every day, summarizes findings, and delivers the report via dashboard, email, and Telegram.
tools: linkup, agent
autonomy: auto
guardrail: never invents facts — only reports what web search returns; cites sources

# Daily Researcher

Runs automated web research on topics you care about — competitors, industry trends, customer sentiment, and anything else you add. Uses live web search (Linkup) to gather current information and synthesizes it into a readable daily summary.

**Tools:** Linkup web search, LLM analysis
**Autonomy:** Auto (runs on schedule, results appear in your Live Feed)
**Guardrail:** Only reports real search results with source attribution — no invented data
**Schedule:** Configurable daily time (default 8:00 AM)
**Delivery:** Dashboard Live Feed + Email + Telegram
