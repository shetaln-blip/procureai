This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

## Moss retrieval

Moss is ProcureAI's **candidate recall** layer. It finds likely-relevant suppliers from the existing JSON catalog. It does **not** score fit, verify claims, calculate landed cost, or replace RFQ/quote/award logic.

Deterministic matching (`lib/matching.ts`) remains the source of truth for supplier ranking.

### Environment variables

Copy `.env.example` to `.env.local` and fill in values from the [Moss portal](https://portal.usemoss.dev). Names:

- `MOSS_PROJECT_ID`
- `MOSS_PROJECT_KEY` (server-side only — never expose to the browser)
- `MOSS_INDEX_NAME` (for example `procureai-suppliers`)
- `MOSS_ENABLED` (`true` to use Moss recall; anything else uses the full catalog)
- `MOSS_MODEL_ID` (optional; defaults to `moss-minilm`)

If Moss is disabled, misconfigured, unauthorized, missing an index, unloaded, empty, or times out, search falls back to the existing full-catalog scan.

### Create and fill the index

1. Create a Moss project and copy the project id and key.
2. Set the variables above (`MOSS_ENABLED` can stay `false` while indexing).
3. Run:

```bash
npx tsx scripts/index-suppliers-to-moss.ts
```

The script loads every supplier JSON file, writes one document per supplier (`supplier-{id}`), creates the index only if it does not exist, and otherwise upserts. It is safe to rerun. Do not run indexing from an HTTP request handler.

4. Set `MOSS_ENABLED=true` and restart `npm run dev`.

### Security

- Keep `MOSS_PROJECT_KEY` in server env only.
- Invitation tokens, token hashes, RFQ secrets, and derived performance metrics are not indexed.
- Moss similarity is not verification. Missing specification evidence still means **Not verified** / **No public evidence available.**

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
