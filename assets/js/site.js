/* Nomad Vacation Rentals — site scripts (vanilla, no dependencies except Leaflet on map pages) */
(function () {
  "use strict";

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ------------------------------------------------------------------ *
   * Page data (injected per page as <script type="application/json">)  *
   * ------------------------------------------------------------------ */
  var DATA = {};
  try {
    var el = $("#page-data");
    if (el) DATA = JSON.parse(el.textContent);
  } catch (e) { /* noop */ }
  window.NOMAD = DATA;

  /* ------------------------------------------------------------------ *
   * Analytics — dataLayer helper.                                       *
   * Real GA4 / GTM / Meta Pixel snippets live in the <head> (commented   *
   * out until container IDs are supplied). Every event below is a real    *
   * push, so wiring GTM is a one-line change.                            *
   * ------------------------------------------------------------------ */
  window.dataLayer = window.dataLayer || [];
  function track(event, payload) {
    var obj = { event: event };
    for (var k in payload) if (Object.prototype.hasOwnProperty.call(payload, k)) obj[k] = payload[k];
    window.dataLayer.push(obj);
    if (document.documentElement.dataset.debugEvents === "true") console.log("[dataLayer]", obj);
  }
  window.nomadTrack = track;

  /* ------------------------------------------------------------------ *
   * Formatting                                                          *
   * ------------------------------------------------------------------ */
  var usd0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  var usd2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
  function money(n) { return usd0.format(Math.round(n)); }
  function money2(n) { return usd2.format(n); }

  /* ------------------------------------------------------------------ *
   * 1. Theme                                                            *
   * ------------------------------------------------------------------ */
  function initTheme() {
    var root = document.documentElement;
    $$(".theme-toggle").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
        root.setAttribute("data-theme", next);
        if (window.nomadStore) window.nomadStore.set("nomad-theme", next);
        btn.setAttribute("aria-label", next === "dark" ? "Switch to light theme" : "Switch to dark theme");
        document.dispatchEvent(new CustomEvent("nomad:theme", { detail: next }));
        track("theme_toggle", { theme: next });
      });
    });
  }

  /* ------------------------------------------------------------------ *
   * 2. Header + mobile nav                                              *
   * ------------------------------------------------------------------ */
  function initHeader() {
    var header = $(".site-header");
    if (!header) return;
    var toggle = $(".nav-toggle");
    var nav = $(".primary-nav");
    if (toggle && nav) {
      toggle.addEventListener("click", function () {
        var open = nav.getAttribute("data-open") === "true";
        nav.setAttribute("data-open", open ? "false" : "true");
        toggle.setAttribute("aria-expanded", open ? "false" : "true");
      });
      $$(".primary-nav a").forEach(function (a) {
        a.addEventListener("click", function () {
          nav.setAttribute("data-open", "false");
          toggle.setAttribute("aria-expanded", "false");
        });
      });
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && nav.getAttribute("data-open") === "true") {
          nav.setAttribute("data-open", "false");
          toggle.setAttribute("aria-expanded", "false");
          toggle.focus();
        }
      });
    }
    var onScroll = function () {
      header.setAttribute("data-stuck", window.scrollY > 24 ? "true" : "false");
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  /* ------------------------------------------------------------------ *
   * 3. Reveal on scroll                                                 *
   * ------------------------------------------------------------------ */
  function initReveal() {
    var els = $$(".reveal");
    if (!els.length) return;
    if (reduceMotion || !("IntersectionObserver" in window)) {
      els.forEach(function (e) { e.classList.add("in"); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          en.target.classList.add("in");
          io.unobserve(en.target);
        }
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
    els.forEach(function (e, i) {
      e.style.transitionDelay = (Math.min(i % 4, 3) * 70) + "ms";
      io.observe(e);
    });
  }

  /* ------------------------------------------------------------------ *
   * 4. (removed) Booking ticker                                         *
   * ------------------------------------------------------------------ *
   * The homepage used to run a marquee of "just booked" notifications.
   * Every one of them was invented, and a live booking ticker on a company
   * with no bookings is fabricated social proof of the most direct kind.
   * The markup and this initialiser were both deleted rather than gated,
   * because there is no version of this component that becomes true later
   * without a real reservation feed behind it.                          */

  /* ------------------------------------------------------------------ *
   * 5. Search autocomplete                                              *
   * ------------------------------------------------------------------ */
  /* Names of the places actually offered, as prose. Never a literal list:
     a destination appears here only once it has a published home, so a
     hardcoded list goes stale the moment inventory changes. */
  function suggestionHint() {
    var names = (DATA.places || [])
      .filter(function (p) { return p.kind === "market"; })
      .map(function (p) { return String(p.name).split(",")[0]; });
    var seen = {};
    names = names.filter(function (n) {
      if (seen[n]) return false;
      seen[n] = 1;
      return true;
    }).slice(0, 5);
    if (!names.length) return "one of our destinations";
    if (names.length === 1) return names[0];
    return names.slice(0, -1).join(", ") + " or " + names[names.length - 1];
  }

  /* Availability is not something this site knows — it lives in the booking
     system. So when a guest has named their nights, the dates are the real
     question and we hand off to the booking widget, which runs the live query.
     Param names are fixed by that widget and are the same set on the
     per-property widget and the portfolio-wide one, which is why a chosen home
     can be sent straight to its own calendar with the dates already applied. */
  function dateParams(form) {
    var val = function (n) {
      var el = $("[name=" + n + "]", form);
      return el && el.value ? el.value : "";
    };
    var checkin = val("checkin");
    var checkout = val("checkout");
    if (!checkin || !checkout) return null;
    var guests = parseInt(String(val("guests")).replace(/[^0-9]/g, ""), 10);
    if (!guests || guests < 1) guests = 2;
    return (
      "checkin=" + encodeURIComponent(checkin) +
      "&checkout=" + encodeURIComponent(checkout) +
      "&adults=" + guests +
      "&children=0&infants=0&pets=0"
    );
  }

  function withParams(base, qs) {
    if (!qs) return base;
    return base + (base.indexOf("?") > -1 ? "&" : "?") + qs;
  }

  function isoToday() {
    var d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }

  function dayAfter(iso) {
    var d = new Date(iso + "T12:00:00");
    if (isNaN(d.getTime())) return "";
    d.setDate(d.getDate() + 1);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }

  /* ------------------------------------------------------------------ *
   * 5b. Searchbar                                                       *
   * ------------------------------------------------------------------ *
   * Choosing a destination fills the field and moves on to the dates. It does
   * NOT navigate. The old version treated a click in the autocomplete as a
   * submission, which threw the guest onto a destination page before they
   * could say when they wanted to come — and destination pages have no date
   * fields, so the nights were simply lost. One control, one job: the list
   * picks a place, the button runs the search.                          */
  function initSearch() {
    var places = DATA.places || [];
    var searchUrl = (DATA.searchUrl || "/search/");
    $$("[data-search]").forEach(function (form) {
      var input = $("[data-search-input]", form);
      var box = $("[data-search-list]", form);
      if (!input || !box) return;
      var inEl = $("[name=checkin]", form);
      var outEl = $("[name=checkout]", form);
      var idx = -1;
      var picked = null;

      /* A live region for the one thing this form has to say back. Built here
         rather than in the markup so every existing searchbar gets it. */
      var note = document.createElement("p");
      note.className = "search-note";
      note.setAttribute("role", "status");
      note.setAttribute("aria-live", "polite");
      form.appendChild(note);
      var say = function (msg) {
        note.textContent = msg || "";
        note.setAttribute("data-show", msg ? "true" : "false");
      };

      /* Nobody checks out before they check in, and nobody books yesterday. */
      if (inEl) {
        inEl.min = isoToday();
        inEl.addEventListener("change", function () {
          if (outEl && inEl.value) {
            outEl.min = dayAfter(inEl.value);
            if (outEl.value && outEl.value <= inEl.value) outEl.value = "";
          }
          say("");
        });
      }
      if (outEl) {
        outEl.min = dayAfter(isoToday());
        outEl.addEventListener("change", function () { say(""); });
      }

      var render = function (list) {
        box.innerHTML = list.length
          ? list.map(function (p) {
              return '<button type="button" role="option" data-url="' + p.url +
                '" data-kind="' + (p.kind || "") + '" data-only="' + (p.only || "") +
                '" data-name="' + String(p.name).replace(/"/g, "&quot;") +
                '">' + p.name + '<span class="ac-sub">' + p.sub + "</span></button>";
            }).join("")
          : '<button type="button" disabled style="cursor:default;color:var(--text-faint)">No match — try ' +
            suggestionHint() + "</button>";
        box.setAttribute("data-open", "true");
        idx = -1;
      };
      var close = function () { box.setAttribute("data-open", "false"); idx = -1; };
      var match = function (q) {
        q = q.trim().toLowerCase();
        if (!q) return places.slice(0, 6);
        return places.filter(function (p) {
          return (p.name + " " + p.sub + " " + (p.keywords || "")).toLowerCase().indexOf(q) > -1;
        }).slice(0, 7);
      };

      /* Selection, not navigation. Fill the box, remember what was chosen, and
         hand the guest to the first date they still have to give us. */
      var choose = function (btn) {
        picked = { name: btn.dataset.name, url: btn.dataset.url, kind: btn.dataset.kind, only: btn.dataset.only || "" };
        input.value = btn.dataset.name;
        close();
        say("");
        var next = (inEl && !inEl.value) ? inEl : (outEl && !outEl.value) ? outEl : null;
        if (next) {
          next.focus();
          /* Chrome and Safari open the native date picker on demand; where they
             do, opening it is the whole point of moving focus here. */
          if (typeof next.showPicker === "function") {
            try { next.showPicker(); } catch (e) {}
          }
        } else {
          var btnEl = $("button[type=submit]", form);
          if (btnEl) btnEl.focus();
        }
      };

      input.addEventListener("focus", function () { render(match(input.value)); });
      input.addEventListener("input", function () {
        picked = null; /* typing invalidates an earlier pick */
        say("");
        render(match(input.value));
      });
      input.addEventListener("keydown", function (e) {
        var opts = $$("button[data-url]", box);
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          if (box.getAttribute("data-open") !== "true") render(match(input.value));
          idx = e.key === "ArrowDown" ? Math.min(idx + 1, opts.length - 1) : Math.max(idx - 1, 0);
          opts.forEach(function (o, i) { o.setAttribute("data-active", i === idx ? "true" : "false"); });
          if (opts[idx]) input.value = opts[idx].dataset.name;
        } else if (e.key === "Enter") {
          /* Enter on a highlighted suggestion picks it. It does not search:
             the guest has not been asked for dates yet. */
          if (opts[idx]) { e.preventDefault(); choose(opts[idx]); }
          else if (box.getAttribute("data-open") === "true" && opts.length === 1) {
            e.preventDefault(); choose(opts[0]);
          }
        } else if (e.key === "Escape") {
          close();
        } else if (e.key === "Tab") {
          close();
        }
      });
      box.addEventListener("click", function (e) {
        var btn = e.target.closest("button[data-url]");
        if (btn) choose(btn);
      });
      document.addEventListener("click", function (e) {
        if (!form.contains(e.target)) close();
      });

      form.addEventListener("submit", function (e) {
        e.preventDefault();
        close();
        var typed = input.value.trim();
        var list = match(typed);
        /* What the guest chose, or — if they typed and never opened the list —
           the single best match for what they typed. */
        var place = (picked && picked.name === input.value) ? picked
          : (typed && list.length ? list[0] : null);

        /* Half a date range is not a date range. Ask for the other half rather
           than silently dropping both, which is what used to happen. */
        var onlyIn = inEl && inEl.value && outEl && !outEl.value;
        var onlyOut = outEl && outEl.value && inEl && !inEl.value;
        if (onlyIn || onlyOut) {
          var missing = onlyIn ? outEl : inEl;
          say(onlyIn ? "Add a check-out date and we will search those nights."
                     : "Add a check-in date and we will search those nights.");
          missing.focus();
          if (typeof missing.showPicker === "function") { try { missing.showPicker(); } catch (err) {} }
          return;
        }

        var qs = dateParams(form);
        if (!place && !qs) {
          say("Tell us where, or give us your dates.");
          render(match(typed));
          input.focus();
          return;
        }

        track("search_submit", {
          destination: place ? place.name : null,
          kind: place ? place.kind : null,
          query: typed || null,
          dates: !!qs
        });

        if (place && qs && (place.kind === "home" || place.only)) {
          /* A named home plus nights: go to that home's own page. Its booking
             widget reads these params, so the calendar arrives already set to
             the requested nights. `only` extends the same courtesy to a
             destination or collection that currently holds exactly one home —
             a results page with a single card is a step for its own sake. */
          window.location.href = withParams(place.kind === "home" ? place.url : place.only, qs);
        } else if (qs) {
          /* Nights but no single home: the portfolio-wide availability search. */
          window.location.href = withParams(searchUrl, qs);
        } else {
          /* A place and no nights: the destination page, where the homes are. */
          window.location.href = place.url;
        }
      });
    });
  }

  /* ------------------------------------------------------------------ *
   * 6. Savings-vs-OTA calculator — cited range, never a single number   *
   * ------------------------------------------------------------------ *
   * The old version multiplied by a single hardcoded percentage and printed
   * one confident dollar figure. Airbnb publishes the guest service fee as a
   * band rather than a fixed rate, so the honest output is a range too.
   * The minimum and maximum come from
   * data/verified.json via data-fee-min / data-fee-max on the root element,
   * so the numbers in the markup, the methodology block and this script can
   * never drift apart. There is also no length-of-stay discount applied
   * here any more: no such discount has been set, so inventing one in
   * JavaScript would put an unverified offer on the page.                */
  function initSavingsCalc() {
    var root = $("[data-calc=savings]");
    if (!root) return;
    var feeMin = parseFloat(root.dataset.feeMin);
    var feeMax = parseFloat(root.dataset.feeMax);
    if (!isFinite(feeMin) || !isFinite(feeMax)) return; // gate is null — render nothing rather than guess
    /* Our own fee, from the same verified source as the page copy. Absent
       attribute means we charge nothing; it is never assumed. */
    var ourPct = parseFloat(root.dataset.ourFee);
    if (!isFinite(ourPct)) ourPct = 0;
    var sel = $("[data-c-property]", root);
    var rateEl = $("[data-c-rate]", root);
    var cleanEl = $("[data-c-clean]", root);
    var nightsEl = $("[data-c-nights]", root);
    var nightsOut = $("[data-c-nights-out]", root);
    var out = {
      sub: $("[data-o-subtotal]", root),
      clean: $("[data-o-clean]", root),
      base: $("[data-o-base]", root),
      fee: $("[data-o-fee]", root),
      save: $("[data-o-save]", root),
      ours: $("[data-o-ours]", root),
      barOta: $("[data-bar-ota]", root),
      barNomad: $("[data-bar-nomad]", root),
      barOtaV: $("[data-bar-ota-v]", root),
      barNomadV: $("[data-bar-nomad-v]", root),
      cta: $("[data-o-cta]", root)
    };
    var props = DATA.calcProperties || [];

    function range(lo, hi) {
      return money(lo) + " \u2013 " + money(hi);
    }

    function calc() {
      var nights = parseInt(nightsEl && nightsEl.value, 10) || 1;
      if (nightsOut) nightsOut.textContent = nights + (nights === 1 ? " night" : " nights");
      var rate = Math.max(0, parseFloat(rateEl && rateEl.value) || 0);
      var clean = Math.max(0, parseFloat(cleanEl && cleanEl.value) || 0);

      var subtotal = rate * nights;
      var base = subtotal + clean;
      var feeLo = base * (feeMin / 100);
      var feeHi = base * (feeMax / 100);
      /* What we charge on the identical base, and the honest difference. */
      var ourFee = base * (ourPct / 100);
      var saveLo = Math.max(0, feeLo - ourFee);
      var saveHi = Math.max(0, feeHi - ourFee);

      if (out.sub) out.sub.textContent = money(subtotal);
      if (out.clean) out.clean.textContent = money(clean);
      if (out.base) out.base.textContent = money(base);
      if (out.fee) out.fee.textContent = range(feeLo, feeHi);
      if (out.ours) out.ours.textContent = money(ourFee);
      if (out.save) out.save.textContent = range(saveLo, saveHi);

      /* Bars compare the direct total against the top of the fee range, and
         the label says so — a bar chart implying the worst case is certain
         would be the same overstatement in a different medium. */
      var otaHi = base + feeHi;
      var ourTotal = base + ourFee;
      var max = otaHi || 1;
      if (out.barOta) out.barOta.style.width = "100%";
      if (out.barNomad) out.barNomad.style.width = (ourTotal / max * 100).toFixed(1) + "%";
      if (out.barOtaV) out.barOtaV.textContent = money(base + feeLo) + " \u2013 " + money(otaHi);
      if (out.barNomadV) out.barNomadV.textContent = money(ourTotal);

      track("calculator_use", {
        calculator: "savings_vs_ota",
        nights: nights,
        nightly_rate: Math.round(rate),
        fee_low: Math.round(feeLo),
        fee_high: Math.round(feeHi),
        our_fee: Math.round(ourFee)
      });
    }

    /* Prefilling from a home is a convenience, not a quote: it drops that
       home's published rate and cleaning fee into the two inputs, which the
       guest can then overwrite. */
    if (sel) {
      sel.addEventListener("change", function () {
        var p = props.filter(function (x) { return x.slug === sel.value; })[0];
        if (p) {
          if (rateEl) rateEl.value = p.nightly;
          if (cleanEl) cleanEl.value = p.cleaningFee;
          if (out.cta) { out.cta.href = p.url; out.cta.textContent = "See " + p.name; }
        }
        calc();
      });
    }
    var debounced = debounce(calc, 120);
    [rateEl, cleanEl, nightsEl].forEach(function (e) { if (e) e.addEventListener("input", debounced); });
    calc();
  }

  /* ------------------------------------------------------------------ *
   * 7. Owner rental-income estimator                                    *
   * ------------------------------------------------------------------ *
   * Rule 7. Every input is now supplied by the owner. The old version
   * shipped per-market base ADRs we had never measured, a management fee
   * we had never quoted, an operating-cost assumption from nowhere, and a
   * revenue-uplift line that was pure invention. All four are
   * gone: this arithmetic uses only numbers the person at the keyboard
   * typed, and it stops before the management fee because that fee is
   * quoted after we see the home.                                       */
  function initIncomeCalc() {
    var root = $("[data-calc=income]");
    if (!root) return;
    var f = {
      adr: $("[data-i-adr]", root),
      occ: $("[data-i-occ]", root),
      occOut: $("[data-i-occ-out]", root),
      days: $("[data-i-days]", root),
      daysOut: $("[data-i-days-out]", root),
      opex: $("[data-i-opex]", root),
      opexOut: $("[data-i-opex-out]", root)
    };
    var out = {
      gross: $("[data-i-gross]", root),
      nights: $("[data-i-nights]", root),
      gross2: $("[data-i-gross2]", root),
      opexv: $("[data-i-opexv]", root),
      net: $("[data-i-net]", root)
    };
    function calc() {
      var adr = Math.max(0, parseFloat(f.adr && f.adr.value) || 0);
      var occ = (parseInt(f.occ && f.occ.value, 10) || 0) / 100;
      var days = parseInt(f.days && f.days.value, 10) || 0;
      var opexPct = (parseInt(f.opex && f.opex.value, 10) || 0) / 100;

      if (f.occOut) f.occOut.textContent = Math.round(occ * 100) + "%";
      if (f.daysOut) f.daysOut.textContent = days + (days === 1 ? " night" : " nights");
      if (f.opexOut) f.opexOut.textContent = Math.round(opexPct * 100) + "%";

      var nights = Math.round(days * occ);
      var gross = nights * adr;
      var opex = gross * opexPct;
      var net = gross - opex;

      if (out.gross) out.gross.textContent = money(gross);
      if (out.nights) out.nights.textContent = nights + (nights === 1 ? " night" : " nights");
      if (out.gross2) out.gross2.textContent = money(gross);
      if (out.opexv) out.opexv.textContent = "\u2212 " + money(opex);
      if (out.net) out.net.textContent = money(net);

      track("calculator_use", {
        calculator: "rental_income",
        nightly_rate: Math.round(adr),
        occupancy_pct: Math.round(occ * 100),
        nights_available: days,
        gross: Math.round(gross)
      });
    }
    var debounced = debounce(calc, 120);
    [f.adr, f.occ, f.days, f.opex].forEach(function (e) { if (e) e.addEventListener("input", debounced); });
    calc();
  }

  /* ------------------------------------------------------------------ *
   * 8. Availability calendar + quote (property page)                    *
   * ------------------------------------------------------------------ */
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  function iso(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function parseISO(s) {
    var p = String(s || "").split("-");
    if (p.length !== 3) return null;
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    return isNaN(d) ? null : d;
  }
  function nightsBetween(a, b) { return Math.round((b - a) / 86400000); }

  function initBooking() {
    var root = $("[data-booking]");
    if (!root) return;
    var p = DATA.property;
    if (!p) return;
    var blocked = {};
    (p.blockedDates || []).forEach(function (d) { blocked[d] = true; });
    var ci = $("[name=checkin]", root);
    var co = $("[name=checkout]", root);
    var note = $("[data-avail-note]", root);
    var quote = $("[data-quote]", root);
    var bookBtn = $("[data-book]", root);
    var today = new Date(); today.setHours(0, 0, 0, 0);
    if (ci) ci.min = iso(today);
    if (co) co.min = iso(new Date(today.getTime() + 86400000));

    function anyBlocked(a, b) {
      var d = new Date(a);
      while (d < b) {
        if (blocked[iso(d)]) return iso(d);
        d = new Date(d.getTime() + 86400000);
      }
      return null;
    }
    function render() {
      var a = parseISO(ci && ci.value), b = parseISO(co && co.value);
      if (!a || !b) {
        setNote("ok", "Pick your dates for an instant, all-in total \u2014 every fee and tax included.");
        renderQuote(null);
        return;
      }
      var n = nightsBetween(a, b);
      if (n < 1) { setNote("bad", "Check-out has to be after check-in."); renderQuote(null); return; }
      if (n < p.minNights) { setNote("bad", "This home has a " + p.minNights + "-night minimum. Add " + (p.minNights - n) + " more night" + (p.minNights - n > 1 ? "s" : "") + "."); renderQuote(null); return; }
      var hit = anyBlocked(a, b);
      if (hit) {
        setNote("bad", "Booked on " + fmtDate(parseISO(hit)) + ". Try shifting your window, or send us the dates and we will tell you what else is open.");
        renderQuote(null);
        return;
      }
      setNote("ok", "Available \u2014 " + n + " night" + (n > 1 ? "s" : "") + " confirmed instantly, held with a card.");
      renderQuote({ nights: n, a: a, b: b });
      track("date_select", { property: p.slug, checkin: iso(a), checkout: iso(b), nights: n });
    }
    function setNote(state, text) {
      if (!note) return;
      note.setAttribute("data-state", state === "bad" ? "bad" : "ok");
      var span = $("span", note);
      (span || note).textContent = text;
    }
    function fmtDate(d) { return MONTHS[d.getMonth()].slice(0, 3) + " " + d.getDate(); }
    function renderQuote(q) {
      if (!quote) return;
      if (!q) { quote.innerHTML = ""; return; }
      /* Length-of-stay discounts are only applied if the home's own record
         carries them. The previous build hardcoded 12% at 7 nights and 28%
         at 28 nights for every property, which is an offer the company had
         never actually made. */
      var disc = 0;
      (p.discountTiers || []).forEach(function (t) {
        if (q.nights >= t.min) disc = t.pct / 100;
      });
      var sub = p.nightly * q.nights;
      var discAmt = sub * disc;
      var taxable = sub - discAmt + p.cleaningFee;
      var tax = taxable * (p.taxPct || 0.1);
      /* Our own booking fee belongs in the total. It was previously left out
         entirely, so the panel showed a Total the guest would never be
         charged, directly under a line saying the marketplace fee is "not
         charged here" — together that read as "nothing extra". The fee comes
         from the same verified number the rest of the site is generated from;
         when it is unverified or zero the row and the term both disappear. */
      var ours = DATA.ourFee && DATA.ourFee.charged ? DATA.ourFee : null;
      var ourFeeAmt = ours ? taxable * (ours.pct / 100) : 0;
      var total = taxable + tax + ourFeeAmt;

      /* The comparison line is a range built from Airbnb's published fee
         band (data/verified.json -> otaFees), not a single invented
         percentage, and it is omitted entirely if the gate is empty. */
      var fees = DATA.otaFees && DATA.otaFees.airbnbGuestServiceFee && DATA.otaFees.airbnbGuestServiceFee.value;
      var feeLo = fees ? taxable * (fees.minPct / 100) : 0;
      var feeHi = fees ? taxable * (fees.maxPct / 100) : 0;

      var rows =
        row(money(p.nightly) + " \u00d7 " + q.nights + " nights", money(sub)) +
        (disc ? row("Length-of-stay discount", "\u2212 " + money(discAmt)) : "") +
        row("Cleaning", money(p.cleaningFee)) +
        row("Lodging tax (estimated at " + Math.round((p.taxPct || 0) * 100) + "%)", money(tax)) +
        (ours ? row(ours.pct + "% booking fee" + (ours.basis ? " (" + ours.basis + ")" : ""), money(ourFeeAmt)) : "") +
        (fees
          ? '<div class="result-line strike"><dt>Airbnb guest service fee (' + fees.minPct + "%\u2013" + fees.maxPct +
            "%), for comparison</dt><dd>" + money(feeLo) + " \u2013 " + money(feeHi) + "</dd></div>"
          : "");
      quote.innerHTML =
        '<dl class="result">' + rows + "</dl>" +
        '<div class="result-total"><span class="small">Total</span><span class="amount">' + money2(total) + "</span></div>" +
        '<p class="tiny" style="margin-top:var(--space-2)">' +
        (fees
          ? "On the same nightly rate and cleaning fee, a marketplace booking would add " + money(feeLo) + " \u2013 " +
            money(feeHi) + " in guest service fee" +
            (ours
              ? " instead of the " + money(ourFeeAmt) + " above"
              : DATA.ourFee && DATA.ourFee.known && !DATA.ourFee.charged
              ? " instead of nothing here"
              : "") +
            ". "
          : "") +
        fmtDate(q.a) + " \u2013 " + fmtDate(q.b) + ", " + p.sleeps + " guests max.</p>";
    }
    function row(k, v) {
      return '<div class="result-line"><dt>' + k + "</dt><dd>" + v + "</dd></div>";
    }
    [ci, co].forEach(function (e) { if (e) e.addEventListener("change", render); });
    if (bookBtn) {
      bookBtn.addEventListener("click", function (e) {
        e.preventDefault();
        track("book_click", {
          property: p.slug,
          market: p.market,
          value: p.nightly,
          checkin: ci && ci.value,
          checkout: co && co.value
        });
        /* Dead path: property pages mount the Hospitable widget, so
           [data-book-msg] is not rendered. Kept as a guard only -- payment is
           taken by the booking provider, and nothing here names a processor. */
        var msg = $("[data-book-msg]", root);
        if (msg) {
          msg.setAttribute("data-show", "true");
          msg.textContent = "Use the booking calendar above to continue.";
        }
      });
    }
    render();
    renderCalendar(root, p, blocked, ci, co, render);
  }

  function renderCalendar(root, p, blocked, ci, co, onPick) {
    var host = $("[data-calendar]");
    if (!host) return;
    var cursor = new Date();
    cursor.setDate(1);
    cursor.setHours(0, 0, 0, 0);
    var today = new Date(); today.setHours(0, 0, 0, 0);

    function build() {
      var html = '<div class="cal-head"><button type="button" class="icon-btn" data-cal-prev aria-label="Previous month">' + chev("left") + '</button><strong data-cal-title></strong><button type="button" class="icon-btn" data-cal-next aria-label="Next month">' + chev("right") + "</button></div>";
      html += '<div class="cal-months">' + month(cursor) + month(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)) + "</div>";
      html += '<p class="tiny" style="margin-top:var(--space-3)"><span class="cal-key"></span> Booked or unavailable. Rates shown are direct rates, before cleaning, fees and tax.</p>';
      host.innerHTML = html;
      $("[data-cal-title]", host).textContent = MONTHS[cursor.getMonth()] + " " + cursor.getFullYear() + " \u2013 " + MONTHS[(cursor.getMonth() + 1) % 12].slice(0, 3) + (cursor.getMonth() === 11 ? " " + (cursor.getFullYear() + 1) : "");
      $("[data-cal-prev]", host).addEventListener("click", function () {
        var prev = new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1);
        if (prev >= new Date(today.getFullYear(), today.getMonth(), 1)) { cursor = prev; build(); }
      });
      $("[data-cal-next]", host).addEventListener("click", function () {
        cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
        build();
      });
      $$("button[data-day]", host).forEach(function (b) {
        b.addEventListener("click", function () {
          var v = b.dataset.day;
          var a = parseISO(ci.value), bb = parseISO(co.value);
          if (!a || bb || parseISO(v) <= a) { ci.value = v; co.value = ""; }
          else { co.value = v; }
          onPick();
          build();
        });
      });
    }
    function month(d) {
      var y = d.getFullYear(), m = d.getMonth();
      var first = new Date(y, m, 1);
      var pad = first.getDay();
      var days = new Date(y, m + 1, 0).getDate();
      var a = parseISO(ci.value), b = parseISO(co.value);
      var cells = "";
      for (var i = 0; i < pad; i++) cells += "<span></span>";
      for (var day = 1; day <= days; day++) {
        var dt = new Date(y, m, day);
        var key = iso(dt);
        var isPast = dt < today;
        var isBlocked = !!blocked[key];
        var cls = [];
        if (a && +dt === +a) cls.push("is-start");
        if (b && +dt === +b) cls.push("is-end");
        if (a && b && dt > a && dt < b) cls.push("is-between");
        cells += (isPast || isBlocked)
          ? '<span class="cal-day is-off" aria-label="' + key + ' unavailable">' + day + "</span>"
          : '<button type="button" class="cal-day ' + cls.join(" ") + '" data-day="' + key + '" aria-label="' + MONTHS[m] + " " + day + ", " + y + '">' + day + "</button>";
      }
      return '<div class="cal-month"><div class="cal-month-name">' + MONTHS[m] + " " + y + '</div><div class="cal-dow"><span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span></div><div class="cal-grid">' + cells + "</div></div>";
    }
    function chev(dir) {
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="' + (dir === "left" ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6") + '"/></svg>';
    }
    build();
  }

  /* ------------------------------------------------------------------ *
   * 9. Filters (browse / city / collection pages)                       *
   * ------------------------------------------------------------------ */
  function initFilters() {
    var root = $("[data-filters]");
    if (!root) return;
    var cards = $$("[data-card]");
    var count = $("[data-result-count]");
    var empty = $("[data-empty]");
    var sortSel = $("[data-sort]");
    var grid = $("[data-grid]");
    var pager = $("[data-pager]");
    var pagerBtn = pager ? $("[data-pager-more]", pager) : null;
    var pagerNote = pager ? $("[data-pager-note]", pager) : null;
    var pagerFill = pager ? $("[data-pager-fill]", pager) : null;
    var PAGE = parseInt((grid && grid.dataset.pageSize) || "12", 10);
    var shownLimit = PAGE;
    var state = {};

    /* Deep links from the portfolio page and elsewhere: /stays/?region=co,
       ?market=denver, ?collections=coastal, ?facets=hot-tub+pool. */
    (function preset() {
      if (!window.location.search) return;
      var q = new URLSearchParams(window.location.search);
      ["region", "market", "collections", "facets", "type", "beds"].forEach(function (key) {
        var raw = q.get(key);
        if (!raw) return;
        var vals = raw.split(/[+,\s]+/).filter(Boolean);
        if (!vals.length) return;
        state[key] = vals;
        vals.forEach(function (v) {
          var btn = $('[data-filter="' + key + '"][data-value="' + v + '"]', root);
          if (btn) btn.setAttribute("aria-pressed", "true");
        });
      });
    })();

    /* Does a card satisfy every active filter group except `skipKey`?
       Excluding one group is what makes the counts on that group's own chips
       read as "how many results would I get", rather than zero. */
    function matches(c, skipKey) {
      var ok = true;
      Object.keys(state).forEach(function (k) {
        if (k === skipKey) return;
        if (!state[k] || !state[k].length) return;
        var vals = (c.dataset[k] || "").split(" ");
        var hit = state[k].some(function (v) { return vals.indexOf(v) > -1; });
        if (!hit) ok = false;
      });
      return ok;
    }

    /* Live counts on every filter chip, plus a disabled state at zero. */
    function counts() {
      $$("[data-filter]", root).forEach(function (btn) {
        var key = btn.dataset.filter;
        var val = btn.dataset.value;
        var n = 0;
        cards.forEach(function (c) {
          if (!matches(c, key)) return;
          if ((c.dataset[key] || "").split(" ").indexOf(val) > -1) n++;
        });
        var slot = $("[data-chip-n]", btn);
        if (slot) slot.textContent = n;
        var pressed = btn.getAttribute("aria-pressed") === "true";
        btn.setAttribute("data-zero", n === 0 && !pressed ? "true" : "false");
        btn.setAttribute("aria-disabled", n === 0 && !pressed ? "true" : "false");
      });
    }

    function paginate(shown) {
      var visible = 0;
      cards.forEach(function (c) {
        if (c.dataset.pass !== "true") return;
        visible++;
        c.hidden = visible > shownLimit;
      });
      if (!pager) return;
      var more = Math.max(0, shown - shownLimit);
      pager.setAttribute("data-show", more > 0 ? "true" : "false");
      if (pagerNote) {
        pagerNote.textContent = "Showing " + Math.min(shown, shownLimit) + " of " + shown +
          (shown === 1 ? " home" : " homes");
      }
      if (pagerFill) {
        pagerFill.style.width = (shown ? Math.min(100, (Math.min(shown, shownLimit) / shown) * 100) : 100) + "%";
      }
      if (pagerBtn) {
        pagerBtn.textContent = "Show " + Math.min(PAGE, more) + " more";
      }
    }

    function apply(keepLimit) {
      if (!keepLimit) shownLimit = PAGE;
      var shown = 0;
      cards.forEach(function (c) {
        var ok = matches(c, null);
        c.dataset.pass = ok ? "true" : "false";
        c.hidden = !ok;
        if (ok) shown++;
      });
      if (count) count.textContent = shown + (shown === 1 ? " home" : " homes");
      if (empty) empty.setAttribute("data-show", shown === 0 ? "true" : "false");
      counts();
      paginate(shown);
      track("filter_apply", { filters: JSON.stringify(state), results: shown });
    }

    $$("[data-filter]", root).forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (btn.getAttribute("data-zero") === "true") return;
        var key = btn.dataset.filter;
        var val = btn.dataset.value;
        var on = btn.getAttribute("aria-pressed") === "true";
        state[key] = state[key] || [];
        if (on) {
          state[key] = state[key].filter(function (v) { return v !== val; });
          btn.setAttribute("aria-pressed", "false");
        } else {
          state[key].push(val);
          btn.setAttribute("aria-pressed", "true");
        }
        apply();
      });
    });

    var reset = $("[data-filter-reset]", root);
    if (reset) reset.addEventListener("click", function () {
      state = {};
      $$("[data-filter]", root).forEach(function (b) { b.setAttribute("aria-pressed", "false"); });
      apply();
    });

    if (pagerBtn) {
      pagerBtn.addEventListener("click", function () {
        shownLimit += PAGE;
        var shown = cards.filter(function (c) { return c.dataset.pass === "true"; }).length;
        paginate(shown);
        track("portfolio_page_more", { showing: Math.min(shown, shownLimit), total: shown });
        /* Move focus to the first newly revealed card so the keyboard and
           screen-reader position does not jump back to the top of the grid. */
        var revealed = cards.filter(function (c) { return c.dataset.pass === "true" && !c.hidden; });
        var target = revealed[Math.max(0, shownLimit - PAGE)];
        var link = target && $("h3 a", target);
        if (link) link.focus({ preventScroll: true });
      });
    }

    if (sortSel && grid) {
      sortSel.addEventListener("change", function () {
        var mode = sortSel.value;
        var items = $$("[data-card]", grid);
        items.sort(function (x, y) {
          var a = parseFloat(x.dataset.price), b = parseFloat(y.dataset.price);
          var ra = parseFloat(x.dataset.rating), rb = parseFloat(y.dataset.rating);
          var sa = parseInt(x.dataset.sleeps, 10), sb = parseInt(y.dataset.sleeps, 10);
          if (mode === "price-asc") return a - b;
          if (mode === "price-desc") return b - a;
          if (mode === "rating") return rb - ra;
          if (mode === "sleeps") return sb - sa;
          if (mode === "newest") return (y.dataset.added || "").localeCompare(x.dataset.added || "");
          return (parseInt(x.dataset.order, 10) || 0) - (parseInt(y.dataset.order, 10) || 0);
        });
        items.forEach(function (i) { grid.appendChild(i); });
        cards = $$("[data-card]");
        apply(true);
        track("sort_change", { sort: mode });
      });
    }
    apply();
  }

  /* ------------------------------------------------------------------ *
   * 10. Lightbox                                                        *
   * ------------------------------------------------------------------ */
  function initLightbox() {
    var lb = $(".lightbox");
    if (!lb) return;
    var imgs = DATA.gallery || [];
    var img = $("[data-lb-img]", lb);
    var cap = $("[data-lb-cap]", lb);
    var i = 0;
    var lastFocus = null;
    function show(n) {
      i = (n + imgs.length) % imgs.length;
      var g = imgs[i];
      img.src = g.src;
      img.srcset = g.srcset || "";
      img.alt = g.alt;
      cap.textContent = (g.caption || g.alt) + "  \u00b7  " + (i + 1) + " / " + imgs.length;
    }
    function open(n) {
      lastFocus = document.activeElement;
      show(n);
      lb.setAttribute("data-open", "true");
      document.body.style.overflow = "hidden";
      $(".lb-close", lb).focus();
      track("gallery_open", { index: n, property: (DATA.property || {}).slug });
    }
    function close() {
      lb.setAttribute("data-open", "false");
      document.body.style.overflow = "";
      if (lastFocus) lastFocus.focus();
    }
    $$("[data-lb-open]").forEach(function (b) {
      b.addEventListener("click", function () { open(parseInt(b.dataset.lbOpen, 10) || 0); });
    });
    $(".lb-close", lb).addEventListener("click", close);
    $(".lb-prev", lb).addEventListener("click", function () { show(i - 1); });
    $(".lb-next", lb).addEventListener("click", function () { show(i + 1); });
    lb.addEventListener("click", function (e) { if (e.target === lb) close(); });
    document.addEventListener("keydown", function (e) {
      if (lb.getAttribute("data-open") !== "true") return;
      if (e.key === "Escape") close();
      if (e.key === "ArrowLeft") show(i - 1);
      if (e.key === "ArrowRight") show(i + 1);
      if (e.key === "Tab") {
        var f = $$("button", lb);
        var first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
  }

  /* ------------------------------------------------------------------ *
   * 11. Leaflet map                                                     *
   * ------------------------------------------------------------------ */
  function initMap() {
    var host = $("[data-map]");
    if (!host || typeof L === "undefined") return;
    var cfg = DATA.map || {};
    var pts = cfg.points || [];
    var map = L.map(host, {
      scrollWheelZoom: false,
      zoomControl: true,
      attributionControl: true
    }).setView([cfg.lat || 39.63, cfg.lng || -105.31], cfg.zoom || 12);
    L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
    }).addTo(map);
    var bounds = [];
    pts.forEach(function (p) {
      /* Pin variants: a plain price pin (a single home), a counted market
         cluster, or a hollow "expanding into" pin for a roadmap market. */
      var cls = "pin";
      if (p.kind === "market") cls += " pin-market";
      if (p.kind === "planned") cls += " pin-planned";
      var icon = L.divIcon({
        className: "",
        html: '<span class="' + cls + '">' + (p.label || "\u25cf") + "</span>",
        iconSize: null
      });
      /* Approximate locations render as a soft area, not a point, so we never
         imply we are showing the exact address of an occupied home. */
      if (p.approx && cfg.approxRadius && L.circle) {
        L.circle([p.lat, p.lng], {
          radius: cfg.approxRadius,
          className: "map-approx",
          interactive: false
        }).addTo(map);
      }
      var m = L.marker([p.lat, p.lng], { icon: icon, title: p.name, alt: p.name }).addTo(map);
      var cta = p.kind === "market" ? "View market &rarr;" : "View home &rarr;";
      var pop = '<div class="map-pop">' +
        (p.img ? '<img src="' + p.img + '" alt="' + p.name + '" loading="lazy" width="224" height="140">' : "") +
        "<strong>" + p.name + "</strong>" +
        '<div class="m">' + (p.meta || "") + "</div>" +
        (p.url ? '<a href="' + p.url + '">' + cta + "</a>" : "");
      m.bindPopup(pop + "</div>");
      m.on("popupopen", function () { track("map_pin_open", { name: p.name }); });
      bounds.push([p.lat, p.lng]);
    });
    if (bounds.length > 1) map.fitBounds(bounds, { padding: [48, 48], maxZoom: 13 });
    if (cfg.approxNote) {
      var nEl = document.createElement("p");
      nEl.className = "map-approx-note";
      nEl.textContent = cfg.approxNote;
      if (el.parentNode) el.parentNode.appendChild(nEl);
    }
    map.on("click", function () { map.scrollWheelZoom.enable(); });
    map.on("mouseout", function () { map.scrollWheelZoom.disable(); });
  }

  /* ------------------------------------------------------------------ *
   * 12. AI concierge demo                                               *
   * ------------------------------------------------------------------ */
  function initConcierge() {
    var panel = $(".concierge");
    var launch = $(".concierge-launch");
    if (!panel || !launch) return;
    var body = $(".concierge-body", panel);
    var suggests = DATA.concierge || [];

    /* Hold the launcher back until the visitor scrolls past the first viewport,
     * so it never sits on top of hero or trust-bar copy. */
    launch.setAttribute("data-visible", "false");
    var gate = function () {
      var past = window.scrollY > Math.min(520, window.innerHeight * 0.7);
      launch.setAttribute("data-visible", past ? "true" : "false");
    };
    gate();
    window.addEventListener("scroll", gate, { passive: true });
    window.addEventListener("resize", gate, { passive: true });

    function open() {
      panel.setAttribute("data-open", "true");
      launch.style.display = "none";
      var f = $("button", panel);
      if (f) f.focus();
      track("concierge_open", {});
    }
    function close() {
      panel.setAttribute("data-open", "false");
      launch.style.display = "";
      launch.focus();
    }
    launch.addEventListener("click", open);
    $("[data-concierge-close]", panel).addEventListener("click", close);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && panel.getAttribute("data-open") === "true") close();
    });
    /* The concierge is a router, not an oracle.
     *
     * It used to answer questions with specific claims about homes — which
     * property had a hot tub, what the cancellation terms were, how fast we
     * answered the phone — composed in this file and never checked against
     * the data. Those answers were a second, unversioned copy of the site's
     * facts, and they were wrong.
     *
     * Now each suggestion carries a `route`, and the only thing the panel
     * does is acknowledge the question and send the visitor to the page that
     * holds the real answer. It cannot state a fact, so it cannot state a
     * false one. */
    $(".concierge-suggests", panel).addEventListener("click", function (e) {
      var btn = e.target.closest("button[data-q]");
      if (!btn) return;
      var item = suggests[parseInt(btn.dataset.q, 10)];
      if (!item) return;
      add("user", item.q);
      var t = add("bot", '<span class="typing"><span></span><span></span><span></span></span>', true);
      track("concierge_query", { query: item.q, route: item.route || null });
      setTimeout(function () {
        t.textContent = item.a;
        if (item.route) {
          var a = document.createElement("a");
          a.className = "link-arrow";
          a.href = item.route;
          a.textContent = "Take me there";
          a.style.display = "inline-block";
          a.style.marginTop = "0.5rem";
          t.appendChild(document.createElement("br"));
          t.appendChild(a);
        }
        body.scrollTop = body.scrollHeight;
      }, reduceMotion ? 40 : 500);
      btn.disabled = true;
      btn.style.opacity = "0.4";
    });
    function add(who, text, html) {
      var d = document.createElement("div");
      d.className = "bubble bubble-" + who;
      if (html) d.innerHTML = text; else d.textContent = text;
      body.appendChild(d);
      body.scrollTop = body.scrollHeight;
      return d;
    }
  }

  /* ------------------------------------------------------------------ *
   * 13. Forms (newsletter, owner lead, contact)                         *
   * ------------------------------------------------------------------ */
  function initForms() {
    $$("[data-form]").forEach(function (form) {
      // The guest portal is a sign-in facade with no backend; leave it inert.
      if (form.dataset.form === "portal") return;

      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var kind = form.dataset.form;
        var status = $("[data-form-status]", form);
        var btn = form.querySelector("button[type=submit], button:not([type])");
        if (!form.checkValidity()) { form.reportValidity(); return; }

        var fd = new FormData(form);
        // Analytics never receives the address itself.
        var payload = {};
        fd.forEach(function (v, k) { payload[k] = (k === "email" || k === "phone") ? "[redacted]" : v; });
        track(kind === "newsletter" ? "newsletter_submit"
            : kind === "owner-lead" ? "owner_lead_submit"
            : "contact_submit", payload);

        // FormSubmit delivers each submission to the inbox below. The honeypot
        // ("bot-field") is checked here; a filled honeypot is treated as sent.
        var FORM_ENDPOINT = "https://formsubmit.co/ajax/normoyle.realestate@gmail.com";
        var subjects = {
          contact: "New website inquiry \u2014 Nomad Vacation Rentals",
          "owner-lead": "New owner evaluation request \u2014 Nomad Vacation Rentals",
          newsletter: "New newsletter sign-up \u2014 Nomad Vacation Rentals"
        };
        var isBot = !!fd.get("bot-field");
        var body = {};
        fd.forEach(function (v, k) {
          if (k === "bot-field" || k === "form-name") return;
          body[k] = v;
        });
        if (form.querySelector("[name=sms_consent]") && !fd.get("sms_consent")) body.sms_consent = "No";
        body._subject = subjects[kind] || "New website form \u2014 Nomad Vacation Rentals";
        body._template = "table";
        body._form = kind;
        body._page = window.location.href;

        function say(msg) {
          if (!status) return;
          status.setAttribute("data-show", "true");
          status.textContent = msg;
        }

        if (btn) { btn.disabled = true; btn.setAttribute("aria-busy", "true"); }
        say("Sending\u2026");

        var send = isBot ? Promise.resolve({ ok: true, json: function () { return { success: "true" }; } })
          : fetch(FORM_ENDPOINT, {
              method: "POST",
              headers: { "Content-Type": "application/json", "Accept": "application/json" },
              body: JSON.stringify(body)
            });
        send.then(function (res) {
          if (!res.ok) throw new Error("HTTP " + res.status);
          return res.json();
        }).then(function (data) {
          if (data && String(data.success) === "false") throw new Error(data.message || "rejected");
          say(kind === "newsletter"
            ? "Thank you \u2014 you are on the list. We email once a month and you can leave in one click."
            : "Thank you \u2014 this has reached us and we will reply within one business day.");
          form.reset();
        })["catch"](function () {
          say("That did not go through. Please email us directly and we will pick it up there.");
        }).then(function () {
          if (btn) { btn.disabled = false; btn.removeAttribute("aria-busy"); }
        });
      });
    });
  }

  /* ------------------------------------------------------------------ *
   * 14. Misc utilities                                                  *
   * ------------------------------------------------------------------ */
  function debounce(fn, ms) {
    var t;
    return function () {
      var a = arguments, c = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(c, a); }, ms);
    };
  }

  function initPropertyViewEvent() {
    var p = DATA.property;
    if (p) track("property_view", { property: p.slug, market: p.market, price: p.nightly });
    if (DATA.pageType) track("page_view_typed", { page_type: DATA.pageType, market: DATA.market || null });
  }

  function initCopyLinks() {
    $$("[data-copy]").forEach(function (b) {
      b.addEventListener("click", function () {
        var v = b.dataset.copy;
        if (navigator.clipboard) navigator.clipboard.writeText(v);
        var old = b.textContent;
        b.textContent = "Copied";
        setTimeout(function () { b.textContent = old; }, 1600);
      });
    });
  }

  /* boot */
  function boot() {
    initTheme();
    initHeader();
    initReveal();
    initSearch();
    initSavingsCalc();
    initIncomeCalc();
    initBooking();
    initFilters();
    initLightbox();
    initConcierge();
    initForms();
    initCopyLinks();
    initPropertyViewEvent();
    if ($("[data-map]")) {
      if (typeof L !== "undefined") initMap();
      else window.addEventListener("load", initMap);
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
