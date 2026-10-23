<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/00206431-913d-4536-8e3b-b8c0301fb722

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`
## Server-side model configuration

Uploaded or pasted race-card parsing uses CheaperInference when `CHEAPERINFERENCE_API_KEY` is configured. The default endpoint is `https://api.cheaperinference.com/v1` and the default model is `gemini-3.1-flash-lite`; `CHEAPERINFERENCE_BASE_URL` and `CHEAPERINFERENCE_MODEL` can override them. Keep the key in Vercel Environment Variables (and `.env.local` for local development), never in browser code. Gemini remains required for live web-search and OTB scraping tasks.
