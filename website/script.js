/**
 * Credit Risk PD Model — script.js
 * Author: Manish Kumar | MBA Business Economics | DBE
 *
 * Architecture:
 *  - predict()         → Currently JS simulation. Replace with Flask call later.
 *  - renderResults()   → Handles all chart and UI updates.
 *  - Chart instances   → All Chart.js instances stored for update/destroy.
 *
 * To integrate Flask API later:
 *  1. Change ONE function: predict() — swap simulatePD() with fetchFromAPI()
 *  2. Everything else (renderResults, charts, UI) stays unchanged.
 */

'use strict';

/* ═══════════════════════════════════════════════════════════════
   CONSTANTS
═══════════════════════════════════════════════════════════════ */
const COLORS = {
  blue:     '#1A56DB',
  blueLt:   '#3B82F6',
  green:    '#10B981',
  amber:    '#F59E0B',
  red:      '#EF4444',
  purple:   '#8B5CF6',
  text:     '#9CA3AF',
  grid:     'rgba(255,255,255,0.06)',
  s1:       '#10B981',
  s2:       '#F59E0B',
  s3:       '#EF4444',
};

// Grade → encoded numeric (A=0 ... G=6)
const GRADE_ENC = { A: 0, B: 1, C: 2, D: 3, E: 4, F: 5, G: 6 };

// Sub-grade → numeric (A1=0 ... G5=34)
const SUBGRADE_ENC = {};
['A','B','C','D','E','F','G'].forEach((g, gi) => {
  [1,2,3,4,5].forEach((n, ni) => { SUBGRADE_ENC[`${g}${n}`] = gi * 5 + ni; });
});

// Home ownership → encoded
const HOME_ENC = { RENT: 0, OWN: 1, MORTGAGE: 2, OTHER: 3 };

// Purpose → encoded (debt_consolidation = most common, lowest baseline)
const PURPOSE_ENC = {
  debt_consolidation: 0, credit_card: 1, home_improvement: 2,
  major_purchase: 3, medical: 4, car: 5, small_business: 6,
  vacation: 7, moving: 8, other: 9,
};

// Model coefficients (from logistic regression, StandardScaler applied)
// These are illustrative weights aligned with the project's feature ranking.
const LR_COEFFICIENTS = {
  int_rate:            0.48,
  sub_grade_enc:       0.44,
  grade_enc:           0.38,
  loan_to_income:      0.22,
  installment_burden:  0.19,
  dti:                 0.16,
  revol_util:          0.12,
  home_ownership_enc: -0.08,
  annual_inc:         -0.15,
  pub_rec:             0.14,
  total_acc:          -0.05,
};

const LR_INTERCEPT = -1.85;

// LGD assumption (Basel II standard)
const LGD = 0.45;

/* ═══════════════════════════════════════════════════════════════
   CHART INSTANCES (stored so we can destroy and redraw)
═══════════════════════════════════════════════════════════════ */
let heroChartInst    = null;
let rocChartInst     = null;
let ivChartInst      = null;
let ifrsDonutInst    = null;
let eclChartInst     = null;
let gaugeChartInst   = null;
let radarChartInst   = null;

/* ═══════════════════════════════════════════════════════════════
   CHART.JS GLOBAL DEFAULTS
═══════════════════════════════════════════════════════════════ */
Chart.defaults.color           = COLORS.text;
Chart.defaults.font.family     = 'Inter, sans-serif';
Chart.defaults.font.size       = 11;
Chart.defaults.plugins.legend.labels.boxWidth  = 12;
Chart.defaults.plugins.legend.labels.usePointStyle = false;

/* ═══════════════════════════════════════════════════════════════
   PREDICTION ENGINE
   ─────────────────────────────────────────────────────────────
   HOW TO SWITCH TO FLASK LATER:
   Replace simulatePD() with fetchFromAPI() below.
   The rest of the code stays exactly the same.
═══════════════════════════════════════════════════════════════ */

/**
 * Main prediction entry point — called by the Predict button.
 * Collects form inputs, runs prediction, renders results.
 */
async function runPrediction() {
  const btn  = document.getElementById('predictBtn');
  const btnTxt = document.getElementById('predictBtnText');

  // Loading state
  btnTxt.innerHTML = '<span class="spinner-sm"></span>Calculating…';
  btn.disabled = true;

  try {
    const inputs = collectFormInputs();

    // ── SWAP THIS LINE TO USE FLASK ──────────────────────────
    const result = await simulatePD(inputs);
    // const result = await fetchFromAPI(inputs);  // ← Flask version
    // ─────────────────────────────────────────────────────────

    renderResults(result);
  } catch (err) {
    console.error('Prediction error:', err);
    alert('Something went wrong. Check console for details.');
  } finally {
    btnTxt.innerHTML = '<i class="bi bi-cpu me-2"></i>Calculate Default Probability';
    btn.disabled = false;
  }
}

/**
 * Collect and validate all form inputs.
 * @returns {Object} raw input values + derived features
 */
function collectFormInputs() {
  const loanAmnt  = parseFloat(document.getElementById('loan_amnt').value)  || 15000;
  const intRate   = parseFloat(document.getElementById('int_rate').value)   || 13.5;
  const annualInc = parseFloat(document.getElementById('annual_inc').value) || 60000;
  const dti       = parseFloat(document.getElementById('dti').value)        || 18.5;
  const empLen    = parseInt(document.getElementById('emp_length').value)   || 5;
  const homeOwn   = document.getElementById('home_ownership').value;
  const purpose   = document.getElementById('purpose').value;
  const revolUtil = parseFloat(document.getElementById('revol_util').value) || 55.0;
  const grade     = document.getElementById('grade').value;
  const subGrade  = document.getElementById('sub_grade').value;
  const totalAcc  = parseInt(document.getElementById('total_acc').value)    || 22;
  const pubRec    = parseInt(document.getElementById('pub_rec').value)      || 0;

  // Derived / engineered features
  const installment        = (loanAmnt * (intRate / 100 / 12)) /
                             (1 - Math.pow(1 + intRate / 100 / 12, -36));
  const loanToIncome       = loanAmnt / (annualInc + 1);
  const installmentBurden  = installment / ((annualInc / 12) + 1);

  return {
    loan_amnt:          loanAmnt,
    int_rate:           intRate,
    annual_inc:         annualInc,
    dti,
    emp_length:         empLen,
    home_ownership:     homeOwn,
    purpose,
    revol_util:         revolUtil,
    grade,
    sub_grade:          subGrade,
    total_acc:          totalAcc,
    pub_rec:            pubRec,
    installment,
    loan_to_income:     loanToIncome,
    installment_burden: installmentBurden,
    grade_enc:          GRADE_ENC[grade]          ?? 2,
    sub_grade_enc:      SUBGRADE_ENC[subGrade]    ?? 10,
    home_ownership_enc: HOME_ENC[homeOwn]         ?? 0,
    purpose_enc:        PURPOSE_ENC[purpose]      ?? 0,
  };
}

/**
 * JavaScript simulation of the logistic regression model.
 * Uses the same feature set and approximate coefficients as the Python model.
 * No server needed — works offline.
 *
 * @param {Object} inputs - collected and engineered features
 * @returns {Promise<Object>} prediction result
 */
async function simulatePD(inputs) {
  // Simulate async processing time
  await new Promise(r => setTimeout(r, 800));

  // Normalisation parameters (approximated from training data)
  const means = {
    int_rate: 13.26, sub_grade_enc: 12.5, grade_enc: 2.5,
    loan_to_income: 0.28, installment_burden: 0.09, dti: 18.2,
    revol_util: 54.8, home_ownership_enc: 0.8, annual_inc: 75000,
    pub_rec: 0.18, total_acc: 25.4,
  };
  const stds = {
    int_rate: 4.8, sub_grade_enc: 8.2, grade_enc: 1.7,
    loan_to_income: 0.22, installment_burden: 0.07, dti: 11.5,
    revol_util: 24.3, home_ownership_enc: 0.9, annual_inc: 65000,
    pub_rec: 0.55, total_acc: 12.1,
  };

  // Standardise features
  const features = {};
  for (const [key, coef] of Object.entries(LR_COEFFICIENTS)) {
    const rawKey = key.replace('_enc', '');
    const val = inputs[key] ?? inputs[rawKey] ?? 0;
    features[key] = (val - (means[key] ?? 0)) / ((stds[key] ?? 1) || 1);
  }

  // Linear combination
  let logit = LR_INTERCEPT;
  for (const [key, coef] of Object.entries(LR_COEFFICIENTS)) {
    logit += coef * (features[key] ?? 0);
  }

  // Sigmoid → PD
  const pd = 1 / (1 + Math.exp(-logit));

  // Clamp to realistic range [0.02, 0.95]
  const pdClamped = Math.min(0.95, Math.max(0.02, pd));

  // ECL calculation
  const ecl = pdClamped * LGD * inputs.loan_amnt;

  // IFRS9 staging
  let stage;
  if (pdClamped < 0.05) stage = 1;
  else if (pdClamped < 0.20) stage = 2;
  else stage = 3;

  // Risk category
  let riskCategory;
  if (pdClamped < 0.15) riskCategory = 'Low Risk';
  else if (pdClamped < 0.40) riskCategory = 'Medium Risk';
  else riskCategory = 'High Risk';

  // Decision
  let decision;
  if (pdClamped < 0.15) decision = 'Approve';
  else if (pdClamped < 0.30) decision = 'Review';
  else if (pdClamped < 0.50) decision = 'Caution';
  else decision = 'Decline';

  // Radar scores (normalised 0–100, higher = more risk)
  const radarScores = {
    'Interest Rate':     Math.min(100, (inputs.int_rate / 36) * 100),
    'DTI Ratio':         Math.min(100, (inputs.dti / 50) * 100),
    'Loan Burden':       Math.min(100, inputs.installment_burden * 600),
    'Credit Util':       Math.min(100, inputs.revol_util),
    'Loan-to-Income':    Math.min(100, inputs.loan_to_income * 250),
    'Public Records':    Math.min(100, inputs.pub_rec * 50),
  };

  return {
    pd: pdClamped,
    ecl,
    stage,
    riskCategory,
    decision,
    radarScores,
    inputs,
  };
}

/**
 * FLASK API VERSION — replace simulatePD() with this function when backend is ready.
 * The POST /predict endpoint should accept JSON and return the same schema.
 *
 * @param {Object} inputs - collected features
 * @returns {Promise<Object>} prediction result from Flask
 */
async function fetchFromAPI(inputs) {
  const response = await fetch('http://localhost:5000/predict', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      loan_amnt:     inputs.loan_amnt,
      int_rate:      inputs.int_rate,
      annual_inc:    inputs.annual_inc,
      dti:           inputs.dti,
      emp_length:    inputs.emp_length,
      home_ownership:inputs.home_ownership,
      purpose:       inputs.purpose,
      revol_util:    inputs.revol_util,
      grade:         inputs.grade,
      sub_grade:     inputs.sub_grade,
      total_acc:     inputs.total_acc,
      pub_rec:       inputs.pub_rec,
    }),
  });

  if (!response.ok) throw new Error(`API error: ${response.status}`);

  // Expected JSON response schema from Flask:
  // {
  //   "pd": 0.35,
  //   "ecl": 2362.50,
  //   "stage": 3,
  //   "riskCategory": "Medium Risk",
  //   "decision": "Review",
  //   "radarScores": { "Interest Rate": 55, ... }
  // }
  return await response.json();
}

/* ═══════════════════════════════════════════════════════════════
   RESULT RENDERING
═══════════════════════════════════════════════════════════════ */

/**
 * Render all result visuals and text from a prediction result object.
 * @param {Object} result - from simulatePD() or fetchFromAPI()
 */
function renderResults(result) {
  const { pd, ecl, stage, riskCategory, decision, radarScores } = result;

  // Show result panel
  document.getElementById('resultPlaceholder').classList.add('d-none');
  document.getElementById('resultContent').classList.remove('d-none');

  // ── PD number display ──────────────────────────────────────
  const pdPct = (pd * 100).toFixed(1) + '%';
  const pdEl  = document.getElementById('pdValueDisplay');
  pdEl.textContent = pdPct;
  pdEl.style.color = pdColor(pd);

  document.getElementById('pdLabelDisplay').textContent = 'Probability of Default';

  // ── Risk needle position ───────────────────────────────────
  const needle = document.getElementById('riskNeedle');
  const needlePct = Math.min(96, Math.max(4, pd * 100)) + '%';
  needle.style.left = needlePct;

  // ── Mini result cards ──────────────────────────────────────
  const stageLabels = { 1: 'Stage 1', 2: 'Stage 2', 3: 'Stage 3' };
  const stageCard   = document.getElementById('resultStageCard');
  stageCard.className = `result-mini-card text-center stage-result-${stage}`;
  document.getElementById('resultStage').textContent = stageLabels[stage];
  document.getElementById('resultStage').style.color = stageColour(stage);

  document.getElementById('resultECL').textContent = '$' + ecl.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  const riskEl = document.getElementById('resultRisk');
  riskEl.textContent = riskCategory;
  riskEl.style.color = pdColor(pd);

  const decEl = document.getElementById('resultDecision');
  decEl.textContent = decision;
  decEl.style.color = decisionColor(decision);

  // ── Recommendation ─────────────────────────────────────────
  document.getElementById('recommendationText').textContent = buildRecommendation(pd, stage, result.inputs);

  // ── Charts ─────────────────────────────────────────────────
  drawGauge(pd);
  drawRadar(radarScores);
}

/**
 * Draw the gauge chart (semi-circle).
 * @param {number} pd - probability of default (0–1)
 */
function drawGauge(pd) {
  if (gaugeChartInst) gaugeChartInst.destroy();

  const pdFraction = Math.min(1, Math.max(0, pd));
  const remaining  = 1 - pdFraction;

  const ctx = document.getElementById('gaugeChart').getContext('2d');
  gaugeChartInst = new Chart(ctx, {
    type: 'doughnut',
    data: {
      datasets: [{
        data: [pdFraction, remaining],
        backgroundColor: [pdColor(pd), 'rgba(255,255,255,0.05)'],
        borderWidth: 0,
        circumference: 180,
        rotation: 270,
      }],
    },
    options: {
      responsive: false,
      cutout: '72%',
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      animation: { duration: 800, easing: 'easeOutQuart' },
    },
  });
}

/**
 * Draw the radar chart showing risk factor breakdown.
 * @param {Object} scores - key: label, value: 0–100 risk score
 */
function drawRadar(scores) {
  if (radarChartInst) radarChartInst.destroy();

  const labels = Object.keys(scores);
  const values = Object.values(scores);
  const ctx = document.getElementById('radarChart').getContext('2d');

  radarChartInst = new Chart(ctx, {
    type: 'radar',
    data: {
      labels,
      datasets: [{
        label: 'Risk factors',
        data: values,
        backgroundColor: 'rgba(26, 86, 219, 0.15)',
        borderColor: COLORS.blueLt,
        borderWidth: 2,
        pointBackgroundColor: COLORS.blueLt,
        pointRadius: 3,
      }],
    },
    options: {
      responsive: true,
      scales: {
        r: {
          min: 0, max: 100,
          grid:        { color: COLORS.grid },
          angleLines:  { color: COLORS.grid },
          ticks:       { display: false },
          pointLabels: { font: { size: 10 }, color: COLORS.text },
        },
      },
      plugins: { legend: { display: false } },
      animation: { duration: 600 },
    },
  });
}

/**
 * Build a plain-English recommendation string based on PD and stage.
 */
function buildRecommendation(pd, stage, inputs) {
  if (pd < 0.15) {
    return `Low default risk. This loan application can be approved at the current interest rate of ${inputs.int_rate}%. Stage 1 classification means a 12-month ECL provision is sufficient.`;
  } else if (pd < 0.30) {
    return `Moderate risk. Consider requesting additional collateral or reducing the loan amount. A co-signer or shorter tenure may reduce the PD below the 20% Stage 3 threshold. Requires underwriter review.`;
  } else if (pd < 0.50) {
    return `Elevated risk. Stage 3 classification requires full lifetime ECL provisioning. Consider declining or offering a significantly reduced loan amount at a higher interest rate with strict repayment monitoring.`;
  } else {
    return `High default risk (PD ${(pd * 100).toFixed(0)}%). Recommend declining this application. The primary drivers appear to be high interest rate (${inputs.int_rate}%) and high DTI (${inputs.dti}%). Applicant should be referred to financial counselling.`;
  }
}

/* ═══════════════════════════════════════════════════════════════
   HELPER FUNCTIONS
═══════════════════════════════════════════════════════════════ */

/** Colour based on PD magnitude */
function pdColor(pd) {
  if (pd < 0.15) return COLORS.green;
  if (pd < 0.35) return COLORS.amber;
  return COLORS.red;
}

/** Colour for IFRS9 stage */
function stageColour(stage) {
  return { 1: COLORS.s1, 2: COLORS.s2, 3: COLORS.s3 }[stage] ?? COLORS.text;
}

/** Colour for credit decision */
function decisionColor(decision) {
  const map = { Approve: COLORS.green, Review: COLORS.amber, Caution: COLORS.amber, Decline: COLORS.red };
  return map[decision] ?? COLORS.text;
}

/** Update sub-grade dropdown when grade changes */
document.addEventListener('DOMContentLoaded', () => {
  const gradeEl    = document.getElementById('grade');
  const subGradeEl = document.getElementById('sub_grade');

  if (gradeEl && subGradeEl) {
    gradeEl.addEventListener('change', () => {
      const g = gradeEl.value;
      subGradeEl.innerHTML = [1,2,3,4,5]
        .map(n => `<option value="${g}${n}">${g}${n}</option>`)
        .join('');
    });
  }

  // Initialise all dashboard charts
  initHeroChart();
  initROCChart();
  initIVChart();
  initIFRS9DonutChart();
  initECLChart();
});

/* ═══════════════════════════════════════════════════════════════
   DASHBOARD CHARTS (static — based on model output data)
═══════════════════════════════════════════════════════════════ */

/** Hero section mini bar chart — PD distribution by stage */
function initHeroChart() {
  const el = document.getElementById('heroChart');
  if (!el) return;
  if (heroChartInst) heroChartInst.destroy();

  const bins   = ['0–5%','5–10%','10–20%','20–30%','30–40%','40–50%','50–60%','60–70%','70–80%','80–90%','90–100%'];
  const counts = [55, 6631, 22128, 28046, 31120, 30943, 28613, 24702, 20406, 16254, 12488];
  const colors = bins.map((_, i) =>
    i === 0 ? COLORS.s1 : i <= 2 ? COLORS.s2 : COLORS.s3
  );

  heroChartInst = new Chart(el.getContext('2d'), {
    type: 'bar',
    data: {
      labels: bins,
      datasets: [{ data: counts, backgroundColor: colors, borderWidth: 0, borderRadius: 3 }],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: {
        x: { display: false },
        y: { display: false },
      },
      animation: { duration: 1200, easing: 'easeOutQuart' },
    },
  });
}

/** ROC curve for both models */
function initROCChart() {
  const el = document.getElementById('rocChart');
  if (!el) return;
  if (rocChartInst) rocChartInst.destroy();

  /** Generate approximate ROC curve points from AUC */
  function rocPoints(auc, n = 40) {
    const pts = [{ x: 0, y: 0 }];
    for (let i = 1; i < n; i++) {
      const fpr = i / n;
      const tpr = Math.min(1, auc * fpr + (1 - auc) * Math.pow(fpr, 0.35));
      pts.push({ x: Math.round(fpr * 100) / 100, y: Math.round(tpr * 100) / 100 });
    }
    pts.push({ x: 1, y: 1 });
    return pts;
  }

  rocChartInst = new Chart(el.getContext('2d'), {
    type: 'scatter',
    data: {
      datasets: [
        {
          label: 'Logistic Regression (AUC 0.668)',
          data: rocPoints(0.6679),
          borderColor: COLORS.blueLt,
          backgroundColor: 'transparent',
          showLine: true, tension: 0.3, pointRadius: 0, borderWidth: 2,
        },
        {
          label: 'Random Forest (AUC 0.689)',
          data: rocPoints(0.6889),
          borderColor: COLORS.amber,
          backgroundColor: 'transparent',
          showLine: true, tension: 0.3, pointRadius: 0, borderWidth: 2,
        },
        {
          label: 'Random baseline',
          data: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
          borderColor: 'rgba(255,255,255,0.15)',
          backgroundColor: 'transparent',
          showLine: true, pointRadius: 0, borderDash: [5, 5], borderWidth: 1,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: 'bottom', labels: { color: COLORS.text, font: { size: 11 } } },
      },
      scales: {
        x: {
          title: { display: true, text: 'False Positive Rate', color: COLORS.text, font: { size: 11 } },
          grid:  { color: COLORS.grid },
          min: 0, max: 1,
        },
        y: {
          title: { display: true, text: 'True Positive Rate', color: COLORS.text, font: { size: 11 } },
          grid:  { color: COLORS.grid },
          min: 0, max: 1,
        },
      },
    },
  });
}

/** IV feature importance horizontal bar chart */
function initIVChart() {
  const el = document.getElementById('ivChart');
  if (!el) return;
  if (ivChartInst) ivChartInst.destroy();

  const features = ['sub_grade', 'int_rate', 'grade', 'loan_to_income', 'install_burden', 'dti', 'loan_amnt', 'revol_util'];
  const ivScores = [0.479, 0.446, 0.398, 0.119, 0.096, 0.074, 0.034, 0.026];
  const barColors = ivScores.map(v => v > 0.3 ? COLORS.red : v > 0.1 ? COLORS.amber : COLORS.blueLt);

  ivChartInst = new Chart(el.getContext('2d'), {
    type: 'bar',
    data: {
      labels: features,
      datasets: [{
        label: 'IV score',
        data: ivScores,
        backgroundColor: barColors,
        borderWidth: 0,
        borderRadius: 4,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: COLORS.grid }, ticks: { color: COLORS.text } },
        y: { grid: { display: false }, ticks: { color: COLORS.text } },
      },
    },
  });
}

/** IFRS9 donut chart — loan count by stage */
function initIFRS9DonutChart() {
  const el = document.getElementById('ifrs9DonutChart');
  if (!el) return;
  if (ifrsDonutInst) ifrsDonutInst.destroy();

  ifrsDonutInst = new Chart(el.getContext('2d'), {
    type: 'doughnut',
    data: {
      labels: ['Stage 1 (PD < 5%)', 'Stage 2 (PD 5–20%)', 'Stage 3 (PD > 20%)'],
      datasets: [{
        data: [55, 19444, 241711],
        backgroundColor: [COLORS.s1, COLORS.s2, COLORS.s3],
        borderWidth: 2,
        borderColor: 'rgba(10, 15, 30, 0.8)',
        hoverOffset: 8,
      }],
    },
    options: {
      responsive: true,
      cutout: '60%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: COLORS.text, font: { size: 11 }, padding: 16 },
        },
        tooltip: {
          callbacks: {
            label: ctx => {
              const total = 261210;
              const pct = ((ctx.raw / total) * 100).toFixed(1);
              return ` ${ctx.label}: ${ctx.raw.toLocaleString()} (${pct}%)`;
            },
          },
        },
      },
      animation: { duration: 1000, easing: 'easeOutQuart' },
    },
  });
}

/** ECL bar chart by stage */
function initECLChart() {
  const el = document.getElementById('eclChart');
  if (!el) return;
  if (eclChartInst) eclChartInst.destroy();

  eclChartInst = new Chart(el.getContext('2d'), {
    type: 'bar',
    data: {
      labels: ['Stage 1 — Low Risk', 'Stage 2 — Watch', 'Stage 3 — Impaired'],
      datasets: [{
        label: 'ECL ($M)',
        data: [0.014502, 18.302, 775.008],
        backgroundColor: [COLORS.s1, COLORS.s2, COLORS.s3],
        borderWidth: 0,
        borderRadius: 6,
      }],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => ` $${ctx.raw.toFixed(2)}M`,
          },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: COLORS.text } },
        y: {
          grid: { color: COLORS.grid },
          ticks: {
            color: COLORS.text,
            callback: v => '$' + v.toFixed(0) + 'M',
          },
        },
      },
      animation: { duration: 1000, easing: 'easeOutQuart' },
    },
  });
}

/* ═══════════════════════════════════════════════════════════════
   NAVBAR SCROLL EFFECT
═══════════════════════════════════════════════════════════════ */
window.addEventListener('scroll', () => {
  const nav = document.getElementById('mainNav');
  if (nav) {
    if (window.scrollY > 60) {
      nav.style.background = 'rgba(10, 15, 30, 0.98)';
    } else {
      nav.style.background = 'rgba(10, 15, 30, 0.85)';
    }
  }
});