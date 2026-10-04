# MUVVHIMII Aviator Analysis Engine v1

This is the real Analysis & Prediction Engine layer for the MUVVHIMII prototype.

## What it does
- Stores user-entered Aviator multipliers in Neon (`aviator_rounds`).
- Reads recent stored rounds from Neon.
- Calculates mean, median, empirical quantiles, standard deviation, coefficient of variation and distribution percentages.
- Refuses to generate a prediction when fewer than 20 rounds are available.
- Uses `baseline-v1`, an explicit empirical-quantile baseline.
- Stores generated prediction records in `aviator_predictions`.
- Stores Success/Fail feedback and updates prediction status.
- Provides aggregate feedback performance.

## Important
This is statistical analysis, not a guaranteed predictor. Historical multipliers should not be assumed to make an independent next round predictable. “Quantum” is UI branding, not quantum computing.

## Deploy
Set `DATABASE_URL` on the server/Render environment to the Neon Production connection string. Never put the connection string in browser JavaScript or commit it to GitHub.
