const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

// DOM Elements
const statusEl = document.getElementById("status");
const refreshBtn = document.getElementById("refresh-btn");
const effrDateEl = document.getElementById("effr-date");

// FedWatch inputs & outputs
const zqSymbolInput = document.getElementById("zq-symbol");
const effrNowInput = document.getElementById("effr-now");
const zqPriceInput = document.getElementById("zq-price");
const meetingDateInput = document.getElementById("meeting-date");
const meetingDayEl = document.getElementById("meeting-day");
const contractLabelEl = document.getElementById("contract-label");

const probCutEl = document.getElementById("prob-cut");
const probHoldEl = document.getElementById("prob-hold");
const probHike25El = document.getElementById("prob-hike25");
const probHike50El = document.getElementById("prob-hike50");
const sumCutEl = document.getElementById("sum-cut");
const sumHoldEl = document.getElementById("sum-hold");
const sumHikeEl = document.getElementById("sum-hike");
const fedwatchNotesEl = document.getElementById("fedwatch-notes");

// US10Y inputs & outputs
const us10ySpotInput = document.getElementById("us10y-spot");
const us10yFuturesInput = document.getElementById("us10y-futures");
const holdThresholdInput = document.getElementById("hold-threshold");
const yieldChangeEl = document.getElementById("yield-change");
const directionOutputEl = document.getElementById("direction-output");
const bpsOutputEl = document.getElementById("bps-output");
const biasOutputEl = document.getElementById("bias-output");

function daysInMonth(year, monthIndex) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function parseISODateUTC(isoStr) {
  const parts = isoStr.split("-").map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
  return { year: parts[0], monthIndex: parts[1] - 1, day: parts[2] };
}

function calculateFedWatch() {
  const effr = Number(effrNowInput.value);
  const zqPrice = Number(zqPriceInput.value);
  const dateParts = parseISODateUTC(meetingDateInput.value);

  if (!Number.isFinite(effr) || !Number.isFinite(zqPrice) || !dateParts) {
    return;
  }

  const { year, monthIndex, day } = dateParts;
  const totalDays = daysInMonth(year, monthIndex);
  const daysBefore = Math.max(0, day - 1);
  const daysFromMeeting = Math.max(1, totalDays - daysBefore);

  meetingDayEl.textContent = String(day);
  contractLabelEl.textContent = `${MONTHS[monthIndex]}/${year}`;

  // CME FedWatch single-meeting month methodology
  const impliedMonthlyAvg = 100 - zqPrice;
  const impliedPostMeetingRate =
    (impliedMonthlyAvg * totalDays - effr * daysBefore) / daysFromMeeting;
  const impliedChange = impliedPostMeetingRate - effr; // in percentage points (0.25 = 25bps)

  let cut = 0;
  let hold = 0;
  let hike25 = 0;
  let hike50 = 0;

  if (impliedChange >= 0) {
    if (impliedChange <= 0.25) {
      hike25 = impliedChange / 0.25;
      hold = 1 - hike25;
    } else {
      hike50 = Math.min(1, (impliedChange - 0.25) / 0.25);
      hike25 = 1 - hike50;
    }
  } else {
    const absCut = Math.abs(impliedChange);
    if (absCut <= 0.25) {
      cut = absCut / 0.25;
      hold = 1 - cut;
    } else {
      cut = 1;
    }
  }

  const totalHike = hike25 + hike50;

  probCutEl.textContent = cut.toFixed(3);
  probHoldEl.textContent = hold.toFixed(3);
  probHike25El.textContent = hike25.toFixed(3);
  probHike50El.textContent = hike50.toFixed(3);

  sumCutEl.textContent = cut.toFixed(3);
  sumHoldEl.textContent = hold.toFixed(3);
  sumHikeEl.innerHTML = `${totalHike.toFixed(3)} <span class="muted">(Hike)</span>`;

  fedwatchNotesEl.textContent =
    `Implied Month Avg: ${impliedMonthlyAvg.toFixed(3)}% | ` +
    `Implied Post-Meeting Rate: ${impliedPostMeetingRate.toFixed(4)}% | ` +
    `Implied Move: ${(impliedChange * 100).toFixed(2)} bps (${daysBefore}d pre / ${daysFromMeeting}d post)`;
}

function calculateUS10Y() {
  const spot = Number(us10ySpotInput.value);
  const futures = Number(us10yFuturesInput.value);
  const threshold = Math.abs(Number(holdThresholdInput.value));

  if (!Number.isFinite(spot) || !Number.isFinite(futures) || !Number.isFinite(threshold)) {
    return;
  }

  const yieldChange = futures - spot;
  const bps = yieldChange * 100;

  yieldChangeEl.textContent = yieldChange.toFixed(3);
  bpsOutputEl.textContent = bps.toFixed(1);

  directionOutputEl.classList.remove("up", "down", "hold");
  biasOutputEl.classList.remove("up", "down", "hold");

  if (yieldChange > threshold) {
    directionOutputEl.textContent = "UP";
    directionOutputEl.classList.add("up");
    biasOutputEl.textContent = "USD UP / HAWKISH (Crypto & Gold BEAR)";
    biasOutputEl.classList.add("up");
  } else if (yieldChange < -threshold) {
    directionOutputEl.textContent = "DOWN";
    directionOutputEl.classList.add("down");
    biasOutputEl.textContent = "USD DOWN / DOVISH (Crypto & Gold BULL)";
    biasOutputEl.classList.add("down");
  } else {
    directionOutputEl.textContent = "HOLD";
    directionOutputEl.classList.add("hold");
    biasOutputEl.textContent = "NEUTRAL / RANGEBOUND";
    biasOutputEl.classList.add("hold");
  }
}

// Fetch EFFR from official NY Fed Markets Data API (CORS-enabled JSON)
async function fetchEFFR() {
  const url = "https://markets.newyorkfed.org/api/rates/unsecured/effr/last/1.json";
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`NY Fed HTTP ${res.status}`);
  const data = await res.json();
  const latest = data?.refRates?.[0];
  if (!latest || typeof latest.percentRate !== "number") {
    throw new Error("Unexpected NY Fed EFFR payload");
  }
  return { rate: latest.percentRate, date: latest.effectiveDate };
}

// Fetch quote from Yahoo Finance via public CORS proxies with fallback price fields
async function fetchYahooQuote(symbol) {
  const target = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
  const proxyBuilders = [
    (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
    (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    (url) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`
  ];

  let lastErr;
  for (const buildProxyUrl of proxyBuilders) {
    try {
      const res = await fetch(buildProxyUrl(target), { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`Proxy HTTP ${res.status}`);

      const json = await res.json();
      const result = json?.chart?.result?.[0];
      const meta = result?.meta;
      const closes = result?.indicators?.quote?.[0]?.close || [];
      const lastClose = [...closes]
        .reverse()
        .find((v) => typeof v === "number" && Number.isFinite(v));

      const price =
        (typeof meta?.regularMarketPrice === "number" && Number.isFinite(meta.regularMarketPrice)
          ? meta.regularMarketPrice
          : null) ??
        lastClose ??
        meta?.chartPreviousClose ??
        meta?.previousClose;

      if (typeof price === "number" && Number.isFinite(price)) {
        return price;
      }
      throw new Error(`No numeric price found for ${symbol}`);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error(`Failed to fetch ${symbol}`);
}

// Convert short CME code like "ZQZ6" -> "ZQZ26.CBT" if user enters short code
function normalizeZQSymbol(raw) {
  const clean = raw.trim().toUpperCase();
  if (clean.includes(".")) return clean;
  const match = clean.match(/^ZQ([FGHJKMNQUVXZ])(\d)$/);
  if (match) {
    const currentDecade = Math.floor(new Date().getFullYear() / 10) * 10;
    const twoDigitYear = (currentDecade + Number(match[2])) % 100;
    return `ZQ${match[1]}${String(twoDigitYear).padStart(2, "0")}.CBT`;
  }
  return clean;
}

async function syncAllFeeds() {
  refreshBtn.disabled = true;
  statusEl.textContent = "Fetching NY Fed EFFR & market quotes...";

  const zqYahooTicker = normalizeZQSymbol(zqSymbolInput.value);

  const [effrRes, zqRes, tnxRes, futRes] = await Promise.allSettled([
    fetchEFFR(),
    fetchYahooQuote(zqYahooTicker),
    fetchYahooQuote("^TNX"),
    fetchYahooQuote("10Y=F")
  ]);

  const notes = [];

  if (effrRes.status === "fulfilled") {
    effrNowInput.value = effrRes.value.rate.toFixed(2);
    effrDateEl.textContent = `EFFR date: ${effrRes.value.date}`;
    notes.push("EFFR ok");
  } else {
    notes.push("EFFR failed (using manual)");
  }

  if (zqRes.status === "fulfilled") {
    zqPriceInput.value = zqRes.value.toFixed(3);
    notes.push(`${zqYahooTicker} ok`);
  } else {
    notes.push(`${zqYahooTicker} failed (using manual)`);
  }

  if (tnxRes.status === "fulfilled") {
    us10ySpotInput.value = tnxRes.value.toFixed(3);
    notes.push("^TNX ok");
  } else {
    notes.push("^TNX failed (using manual)");
  }

  if (futRes.status === "fulfilled") {
    us10yFuturesInput.value = futRes.value.toFixed(3);
    notes.push("10Y=F ok");
  } else {
    notes.push("10Y=F failed (using manual)");
  }

  calculateFedWatch();
  calculateUS10Y();

  statusEl.textContent = `Last sync: ${new Date().toLocaleTimeString()} — ${notes.join(" | ")}`;
  refreshBtn.disabled = false;
}

// Recalculate instantly whenever any input is edited manually
[zqSymbolInput, effrNowInput, zqPriceInput, meetingDateInput].forEach((el) => {
  el.addEventListener("input", calculateFedWatch);
});

[us10ySpotInput, us10yFuturesInput, holdThresholdInput].forEach((el) => {
  el.addEventListener("input", calculateUS10Y);
});

refreshBtn.addEventListener("click", syncAllFeeds);

// Run initial calculation on default values immediately, then attempt live sync
calculateFedWatch();
calculateUS10Y();
syncAllFeeds();
