# RaceWise AI Pipeline Architecture

End-to-end description of how RaceWise transforms raw race data into betting
outputs. The pipeline is linear: **Ingest → Extract → Handicap → Price →
Emit**.

---

## 1. Data Ingestion

Raw material enters the pipeline via one of five Tool Modes:

| Mode | Source | Format |
| --- | --- | --- |
| Morning Card / Live | Scraped odds, fields, scratches (e.g. offtrackbetting.com) | HTML / text |
| TRD (Today's Racing Digest) | User upload | PDF |
| DRF (Daily Racing Form) | User upload | PDF |
| Backup / Manual | Direct text paste or fallback PDFs | Text / PDF |

Uploaded PDFs are converted to **Base64** so they can be passed natively to
Gemini's document-processing engine. See `services/geminiService.ts`
(`ParseRequest.pdfData`).

---

## 2. Neural Extraction (Gemini 3.1 Pro)

Gemini is used as a **structured parser**, not a handicapper. The call is
constrained by `RESPONSE_SCHEMA` in `services/geminiService.ts:13`, which forces
output into a rigid JSON shape.

Required fields per horse (`services/geminiService.ts:64`):

- `name`, `programNumber`, `jockey`, `trainer`, `weight`, `morningLine`

Additional fields extracted when present:

- **Market:** `morningLine`, `liveOdds`
- **Performance metrics:** `fire`, `cpr`, `fastFig`, `consensus`
- **Ensemble inputs:** `catboostScore`, `lightgbmScore`, `rnnScore`,
  `xgboostScore`
- **Class signals:** `classToday`, `classRecentBest`
- **Form:** `pastPerformances[]` (last 5 races: date, finish, dist)
- **Connections:** `jockeyWinRate`, `trainerWinRate`
- **Notes:** `hf` (longshot flag), `comments`

Race-level identifiers: `track`, `date`, race `number`, `distance`, `surface`.

---

## 3. Handicapping — Weighted Ensemble

Once Gemini returns structured JSON, `processHandicapping` in `utils.ts:8`
scores every horse.

### 3.1 Base ensemble score (`utils.ts:28`)

Weights sum to 100%:

| Weight | Signal | Field |
| ---: | --- | --- |
| 20.0% | Fire Speed Figures | `fire` |
| 15.4% | CatBoost | `catboostScore` |
| 12.0% | Jockey Win Power | `jockeyWinRate` |
| 12.0% | Trainer Win Power | `trainerWinRate` |
| 12.0% | HC 20 Longshot Logic | `hf` contains "20" → 100 points |
| 11.0% | LightGBM | `lightgbmScore` |
|  6.6% | Consensus | `consensus` |
|  6.6% | RNN Sequence | `rnnScore` |
|  4.4% | XGBoost | `xgboostScore` |

### 3.2 Class Drop multiplier (`utils.ts:41`)

Applied after the base score:

- `classRecentBest - classToday ≥ 10` → **×1.25** (major drop)
- `classRecentBest - classToday ≥ 5`  → **×1.10** (moderate drop)
- Otherwise → **×1.00**

### 3.3 Ranking (`utils.ts:59`)

Horses are sorted by `modelScore` descending. Ties share a rank; the next
distinct score jumps to its absolute position (standard competition ranking).

---

## 4. Probability & Fair Odds (`utils.ts:71`)

1. **Field total:** sum every horse's `modelScore` in the race.
2. **Win probability:** `horse.modelScore / totalModelScore`.
3. **Win percentage:** probability × 100, one decimal.
4. **Decimal fair odds:** `(1 / probability) - 1`.
5. **Fractional fair odds:** rounded to the nearest common fraction via
   `formatToFractional` in `utils.ts:95` (e.g. `1-9`, `2-5`, `5-2`, `99-1`).

A horse with a 28% probability lands near `5-2`.

---

## 5. Output & Persistence

The final `PipelineResult` branches to multiple sinks:

- **UI rendering** — Betting Sheets, Rankings, Data Tables (`App.tsx`,
  `index.tsx`).
- **CSV export** — `convertToCSV` in `utils.ts:127`; schema mirrors
  `csv_schema.json`.
- **XML export** — generated from the same flattened rows.
- **Supabase sync** — nested race/horse JSON is flattened and upserted via
  `services/supabaseClient.ts` for historical backtesting.

---

## Data Shape Reference

Canonical TypeScript definitions live in `types.ts` (`PipelineResult`, `Race`,
`Horse`). Every stage of the pipeline operates on this shape; fields added
during handicapping (`weightedScore`, `modelScore`, `rank`, `modelOdds`,
`winPercentage`) are layered on top of the Gemini-extracted base.
