/* =====================================================================
   Cash Register Calculator — application logic
   =====================================================================
   This file is the entire app's behavior:
     1. Defines the CAD denominations (coins + bills)
     2. Renders the count rows in the UI
     3. Tracks counts, computes totals, formats currency
     4. Implements the "balance to target" algorithm
     5. Handles the settings modal (editable target + ideal composition)

   IMPORTANT: All money values are stored as integer CENTS internally.
   We never use floating-point dollars — that avoids classic bugs like
   0.1 + 0.2 = 0.30000000000000004. Conversion to dollars happens only
   when we display values to the user (see formatCents).
   ===================================================================== */


/* ---------------------------------------------------------------------
   1. CONSTANTS
   --------------------------------------------------------------------- */

/**
 * The list of CAD denominations the app supports.
 *   id    — unique key used in state objects (counts, ideal, etc.)
 *   label — what the user sees on screen
 *   value — the denomination's worth in CENTS (integer)
 *
 * Order is small → large; we reverse for display so users start with
 * the largest bill on top (matches how registers are physically laid out).
 */
const DENOMINATIONS = [
  { id: 'c5',   label: '5¢',   value: 5     },
  { id: 'c10',  label: '10¢',  value: 10    },
  { id: 'c25',  label: '25¢',  value: 25    },
  { id: 'd1',   label: '$1',   value: 100   },
  { id: 'd2',   label: '$2',   value: 200   },
  { id: 'd5',   label: '$5',   value: 500   },
  { id: 'd10',  label: '$10',  value: 1000  },
  { id: 'd20',  label: '$20',  value: 2000  },
  { id: 'd50',  label: '$50',  value: 5000  },
  { id: 'd100', label: '$100', value: 10000 },
];

/**
 * Standard CAD coin rolls (Royal Canadian Mint quantities).
 * Each roll is treated as a single removable unit with a fixed face value.
 *   id      — unique key in rollCounts
 *   label   — what the user sees
 *   perRoll — how many coins make up one roll (informational)
 *   value   — face value of one full roll, in CENTS
 */
const COIN_ROLLS = [
  { id: 'roll_c5',  label: '5¢ roll',  perRoll: 40, value: 200  },  // $2
  { id: 'roll_c10', label: '10¢ roll', perRoll: 50, value: 500  },  // $5
  { id: 'roll_c25', label: '25¢ roll', perRoll: 40, value: 1000 },  // $10
  { id: 'roll_d1',  label: '$1 roll',  perRoll: 25, value: 2500 },  // $25
  { id: 'roll_d2',  label: '$2 roll',  perRoll: 25, value: 5000 },  // $50
];

/**
 * Default target and ideal float composition.
 * The composition is what should remain in the till AFTER balancing.
 * It must sum to the target. The default sums to $200.00 and is weighted
 * toward small denominations so there's enough change for any sale.
 *
 *   40 × 5¢   = $2          25 × $1   = $25
 *   50 × 10¢  = $5           9 × $2   = $18
 *   40 × 25¢  = $10          8 × $5   = $40
 *                           10 × $10  = $100
 *                                       ----
 *                                       $200
 */
const DEFAULTS = {
  targetCents: 20000,
  ideal: {
    c5: 40, c10: 50, c25: 40,
    d1: 25, d2: 9,
    d5: 8,  d10: 10,
    d20: 0, d50: 0, d100: 0,
  },
};


/* ---------------------------------------------------------------------
   2. STATE
   ---------------------------------------------------------------------
   Two pieces of mutable state, both plain objects keyed by denom id:

   • settings — target amount + ideal composition (editable in modal)
   • counts   — what the user has entered for each denomination

   No persistence: both reset to defaults whenever the page reloads,
   per spec.
   --------------------------------------------------------------------- */

const settings = {
  targetCents: DEFAULTS.targetCents,
  ideal: { ...DEFAULTS.ideal },
};

const counts = {};
DENOMINATIONS.forEach(d => { counts[d.id] = 0; });

const rollCounts = {};
COIN_ROLLS.forEach(r => { rollCounts[r.id] = 0; });


/* ---------------------------------------------------------------------
   3. HELPERS — currency formatting & parsing
   --------------------------------------------------------------------- */

/**
 * Format an integer cents value as a dollar string, e.g. 12345 → "$123.45".
 * Handles negative values: -50 → "-$0.50".
 */
function formatCents(cents) {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return sign + '$' + (abs / 100).toFixed(2);
}

/**
 * Parse a user-entered dollar string into integer cents.
 * Returns NaN if the input isn't a valid number.
 * We round to avoid floating-point issues (e.g. "1.99" * 100 = 198.999...).
 */
function parseDollarsToCents(s) {
  const n = parseFloat(s);
  if (isNaN(n)) return NaN;
  return Math.round(n * 100);
}

/** Look up a denomination object by its id. */
function denomById(id) {
  return DENOMINATIONS.find(d => d.id === id);
}

/** Look up a coin-roll object by its id. */
function rollById(id) {
  return COIN_ROLLS.find(r => r.id === id);
}

/** Total in cents = loose coins/bills + full rolls. */
function computeTotalCents() {
  const loose = DENOMINATIONS.reduce((s, d) => s + counts[d.id] * d.value, 0);
  const rolls = COIN_ROLLS.reduce((s, r) => s + rollCounts[r.id] * r.value, 0);
  return loose + rolls;
}


/* ---------------------------------------------------------------------
   4. RENDERING — the count rows in the main UI
   --------------------------------------------------------------------- */

/**
 * Build one count row per item (denom or roll) inside the given container.
 *
 * The renderer is generic so we can reuse it for both the "Bills & Coins"
 * list and the "Coin Rolls" list:
 *   • items     — array of { id, label, value, ... }
 *   • container — the <div> to populate (already in the DOM)
 *   • countMap  — the state object whose values get mutated on input
 *
 * Listeners are attached via event delegation on the container, so we
 * register them once even though there are many inputs.
 */
function renderCountRows(items, container, countMap) {
  container.innerHTML = '';

  // Largest first → matches the physical layout of a register drawer
  const ordered = [...items].reverse();

  ordered.forEach(item => {
    const row = document.createElement('div');
    row.className = 'denom-row';
    // Input starts blank — an empty box reads as 0, no placeholder needed
    row.innerHTML = `
      <span class="denom-label">${item.label}</span>
      <input class="count-input" type="number" inputmode="numeric" min="0" data-id="${item.id}" aria-label="${item.label} count" />
      <span class="subtotal" data-id="${item.id}">$0.00</span>
    `;
    container.appendChild(row);
  });

  // One delegated listener for typing into any count input in this list
  container.addEventListener('input', e => {
    if (!e.target.matches('.count-input')) return;
    const id = e.target.dataset.id;
    const val = parseInt(e.target.value, 10);
    // Empty / negative / NaN → treat as 0
    countMap[id] = isNaN(val) || val < 0 ? 0 : val;
    refreshSubtotal(id);
    refreshTotal();
  });
}

/** Update one row's subtotal cell after its count changes. */
function refreshSubtotal(id) {
  const item = denomById(id) || rollById(id);
  if (!item) return;
  const count = (denomById(id) ? counts : rollCounts)[id];
  // Subtotal cells live in different containers; scope by id (which is unique)
  const cell = document.querySelector(`.subtotal[data-id="${id}"]`);
  if (cell) cell.textContent = formatCents(count * item.value);
}

/** Recompute and display the total in the sticky footer. */
function refreshTotal() {
  document.getElementById('total-amount').textContent = formatCents(computeTotalCents());
}


/* ---------------------------------------------------------------------
   5. THE BALANCE ALGORITHM
   ---------------------------------------------------------------------
   Goal: figure out which loose bills/coins to remove so the till is
   left with exactly `settings.targetCents`.

   Coin rolls are treated as a RESERVE: they count toward the till's
   total (so a $50 toonie roll contributes $50 to the running balance),
   but they are NEVER suggested for removal. Only loose bills and coins
   get deposited.

   Strategy: single-pass greedy over loose denominations only, largest
   face value first.

   Three possible outcomes:
     • 'ok'          → list of loose items to remove
     • 'shortfall'   → till total is below target; can't reach it at all
     • 'unreachable' → till total is above target, but the loose items
                       alone can't be reduced to exactly the target
                       (e.g. the till is over because of rolls we won't
                       break, or the loose mix can't subtract to the
                       right amount)
   --------------------------------------------------------------------- */

function computeBalance() {
  const target = settings.targetCents;
  const total = computeTotalCents(); // includes rolls

  // -- Case A: under target ------------------------------------------
  if (total < target) {
    // Surface which loose denominations are below the ideal float, so
    // the user knows where the drawer is short. (Rolls aren't part of
    // the "ideal" composition — they're a separate reserve.)
    const shortDenoms = DENOMINATIONS
      .slice()
      .reverse() // display largest first
      .filter(d => counts[d.id] < (settings.ideal[d.id] || 0))
      .map(d => ({
        label: d.label,
        missing: settings.ideal[d.id] - counts[d.id],
      }));

    return {
      status: 'shortfall',
      shortfallCents: target - total,
      shortDenoms,
    };
  }

  // -- Case B: exactly on target -------------------------------------
  if (total === target) {
    return { status: 'ok', removeLoose: {}, totalRemovedCents: 0 };
  }

  // -- Case C: over target — pick loose items to remove --------------
  let toRemove = total - target;
  const removeLoose = {};
  DENOMINATIONS.forEach(d => { removeLoose[d.id] = 0; });

  // Largest face value first. Rolls are intentionally excluded — they
  // stay in the till as a reserve.
  const looseLargestFirst = [...DENOMINATIONS].sort((a, b) => b.value - a.value);

  for (const d of looseLargestFirst) {
    if (toRemove === 0) break;
    const canTake = Math.min(counts[d.id], Math.floor(toRemove / d.value));
    if (canTake === 0) continue;
    removeLoose[d.id] += canTake;
    toRemove -= canTake * d.value;
  }

  // If loose alone can't reach the target exactly, say so. This happens
  // when the till is over because of rolls (which we won't break) or
  // when the loose mix can't subtract to the right amount.
  if (toRemove > 0) {
    return {
      status: 'unreachable',
      closestRemainderCents: target + toRemove,
    };
  }

  return {
    status: 'ok',
    removeLoose,
    totalRemovedCents: total - target,
  };
}


/* ---------------------------------------------------------------------
   6. BALANCE RESULT MODAL
   --------------------------------------------------------------------- */

function openBalanceModal() {
  const result = computeBalance();
  const container = document.getElementById('balance-result');
  container.innerHTML = renderBalanceHTML(result);
  document.getElementById('balance-modal').hidden = false;
}

/**
 * Build the HTML for the balance result based on the algorithm's output.
 * Three branches mirror the three outcomes from computeBalance().
 */
function renderBalanceHTML(result) {
  const targetStr = formatCents(settings.targetCents);

  // OK — no removal needed (already balanced)
  if (result.status === 'ok' && result.totalRemovedCents === 0) {
    return `
      <div class="result-status ok">
        Already balanced — exactly ${targetStr} in the till.
      </div>
    `;
  }

  // OK — removal list (loose only; rolls are reserve)
  if (result.status === 'ok') {
    const items = [...DENOMINATIONS].reverse()
      .filter(d => result.removeLoose[d.id] > 0)
      .map(d => `
        <li>
          <span><span class="remove-count">${result.removeLoose[d.id]}×</span> ${d.label}</span>
          <span>${formatCents(result.removeLoose[d.id] * d.value)}</span>
        </li>
      `).join('');

    return `
      <div class="result-status ok">
        Remove the following to leave ${targetStr} in the till:
      </div>
      <ul class="remove-list">${items}</ul>
      <div class="ideal-sum-row">
        <span>Total to deposit</span>
        <span>${formatCents(result.totalRemovedCents)}</span>
      </div>
    `;
  }

  // Shortfall — till is below target
  if (result.status === 'shortfall') {
    const shortList = result.shortDenoms.length === 0 ? '' : `
      <p>Below ideal composition:</p>
      <ul class="remove-list">
        ${result.shortDenoms.map(s => `
          <li>
            <span>${s.label}</span>
            <span class="remove-count">missing ${s.missing}</span>
          </li>
        `).join('')}
      </ul>
    `;

    return `
      <div class="result-status warning">
        Till is short by ${formatCents(result.shortfallCents)} — cannot reach ${targetStr}.
      </div>
      ${shortList}
    `;
  }

  // Unreachable — over target but loose alone can't subtract to it
  return `
    <div class="result-status warning">
      Cannot reach exactly ${targetStr} by removing loose bills and coins.
    </div>
    <p>Closest amount we could leave: ${formatCents(result.closestRemainderCents)}.</p>
    <p class="hint">Coin rolls aren't broken open by this calculation — if the till is over because of rolls, you'd need to break one (or accept the closest amount).</p>
  `;
}


/* ---------------------------------------------------------------------
   7. SETTINGS MODAL
   ---------------------------------------------------------------------
   Lets the user edit:
     • the target amount (default $200)
     • the ideal float composition (count per denomination)

   The ideal composition's running sum is shown live and must equal the
   target before "Save" is allowed (otherwise an error message appears).
   --------------------------------------------------------------------- */

function openSettingsModal() {
  // Pre-fill the target field with the current target (in dollars)
  document.getElementById('target-input').value =
    (settings.targetCents / 100).toFixed(2);

  // Build one row per denomination inside the composition editor
  renderIdealRows();

  // Make sure no leftover error message is visible
  hideError();

  document.getElementById('settings-modal').hidden = false;
}

/** Build the per-denomination input rows in the settings modal. */
function renderIdealRows() {
  const container = document.getElementById('ideal-list');
  container.innerHTML = '';

  const ordered = [...DENOMINATIONS].reverse();
  ordered.forEach(d => {
    const current = settings.ideal[d.id] || 0;
    const row = document.createElement('div');
    row.className = 'ideal-row';
    row.innerHTML = `
      <span>${d.label}</span>
      <input type="number" inputmode="numeric" min="0" value="${current}" data-id="${d.id}" aria-label="Ideal ${d.label}" />
      <span class="ideal-subtotal" data-id="${d.id}">${formatCents(current * d.value)}</span>
    `;
    container.appendChild(row);
  });

  refreshIdealSum();
}

/**
 * Read the live values from the settings inputs and update:
 *   • each row's subtotal
 *   • the composition total
 *   • the mismatch indicator (red if total ≠ target)
 *
 * This runs on every keystroke in the settings modal.
 */
function refreshIdealSum() {
  let sum = 0;
  document.querySelectorAll('#ideal-list input').forEach(inp => {
    const d = denomById(inp.dataset.id);
    const v = parseInt(inp.value, 10) || 0;
    sum += v * d.value;
    // Per-row subtotal
    const sub = document.querySelector(`.ideal-subtotal[data-id="${inp.dataset.id}"]`);
    if (sub) sub.textContent = formatCents(v * d.value);
  });

  const target = parseDollarsToCents(document.getElementById('target-input').value);
  const sumEl = document.getElementById('ideal-sum');
  sumEl.textContent = formatCents(sum);

  // Highlight mismatch in red
  const sumRow = sumEl.closest('.ideal-sum-row');
  if (!isNaN(target) && sum !== target) {
    sumRow.classList.add('mismatch');
  } else {
    sumRow.classList.remove('mismatch');
  }

  // If the user is fixing things, hide any old error message
  hideError();
}

/** Validate the settings form and commit it to `settings` if valid. */
function saveSettings() {
  const targetCents = parseDollarsToCents(
    document.getElementById('target-input').value
  );

  if (isNaN(targetCents) || targetCents <= 0) {
    showError('Target must be a positive number.');
    return;
  }

  // Read each per-denomination ideal count, summing as we go
  const newIdeal = {};
  let sum = 0;
  document.querySelectorAll('#ideal-list input').forEach(inp => {
    const id = inp.dataset.id;
    const v = parseInt(inp.value, 10);
    // Treat blank / negative / NaN as 0
    const safe = isNaN(v) || v < 0 ? 0 : v;
    newIdeal[id] = safe;
    sum += safe * denomById(id).value;
  });

  // Composition must add up to target — this is the central invariant
  // of the balance algorithm.
  if (sum !== targetCents) {
    showError(
      `Composition total (${formatCents(sum)}) must equal target (${formatCents(targetCents)}).`
    );
    return;
  }

  // Commit changes
  settings.targetCents = targetCents;
  settings.ideal = newIdeal;

  // Update the button label so it shows the new target
  document.getElementById('target-display').textContent = formatCents(targetCents);

  // Done — close modal
  document.getElementById('settings-modal').hidden = true;
}

/** Reset the settings form fields back to the hardcoded defaults. */
function resetToDefaults() {
  document.getElementById('target-input').value =
    (DEFAULTS.targetCents / 100).toFixed(2);
  document.querySelectorAll('#ideal-list input').forEach(inp => {
    inp.value = DEFAULTS.ideal[inp.dataset.id] || 0;
  });
  refreshIdealSum();
  hideError();
}

function showError(msg) {
  const el = document.getElementById('ideal-error');
  el.textContent = msg;
  el.hidden = false;
}

function hideError() {
  document.getElementById('ideal-error').hidden = true;
}


/* ---------------------------------------------------------------------
   8. WIRING — attach all event listeners + initial paint
   --------------------------------------------------------------------- */

function init() {
  // Build both count lists: loose denominations and coin rolls
  renderCountRows(
    DENOMINATIONS,
    document.getElementById('denomination-list'),
    counts
  );
  renderCountRows(
    COIN_ROLLS,
    document.getElementById('roll-list'),
    rollCounts
  );
  refreshTotal();

  // Footer button label reflects current target
  document.getElementById('target-display').textContent = formatCents(settings.targetCents);

  // Top-level buttons
  document.getElementById('balance-btn').addEventListener('click', openBalanceModal);
  document.getElementById('settings-btn').addEventListener('click', openSettingsModal);

  // Settings modal actions
  document.getElementById('save-settings-btn').addEventListener('click', saveSettings);
  document.getElementById('reset-defaults-btn').addEventListener('click', resetToDefaults);

  // Recompute composition total on any input in the settings modal
  document.getElementById('target-input').addEventListener('input', refreshIdealSum);
  document.getElementById('ideal-list').addEventListener('input', refreshIdealSum);

  // Close-button handler (works for both modals via [data-close="modalId"])
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById(btn.dataset.close).hidden = true;
      hideError();
    });
  });

  // Tap on the dimmed backdrop also closes the modal
  document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', e => {
      if (e.target === modal) {
        modal.hidden = true;
        hideError();
      }
    });
  });
}

// `defer` on the <script> tag guarantees the DOM is parsed before this
// runs, so we can call init() immediately.
init();
