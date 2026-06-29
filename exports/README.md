# Exports

Generated standalone HTML exports live under `exports/standalone/`.

Run:

```bash
npm run build
npm run export:all
npm run smoke:exports
```

The standalone files are checked to avoid live `/assets/`, `/src/`, or manifest references. They should use neutral public-safe assets by default.
