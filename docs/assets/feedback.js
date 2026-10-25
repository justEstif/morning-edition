/* Morning Edition feedback store — shared by the edition page and the grade page.
   Append-only JSONL in localStorage under key 'me-feedback-events', one JSON
   object per line:
     {"ts":"ISO-8601","type":"vote|grade","value":"up|down|deep-read|skim|capture",
      "item_id":"miniflux-8123","edition_date":"YYYY-MM-DD"}
   Duplicate events for the same item+type are allowed; later ts wins at
   analysis time — never dedupe client-side. No network calls. */
(function () {
  'use strict';
  var KEY = 'me-feedback-events';
  var VALID = { vote: ['up', 'down'], grade: ['deep-read', 'skim', 'capture'] };

  function lines() {
    var raw = localStorage.getItem(KEY);
    if (!raw) { return []; }
    return raw.split('\n').filter(function (l) { return l.trim().length > 0; });
  }

  function append(type, value, itemId, editionDate) {
    if (!(type in VALID) || VALID[type].indexOf(value) === -1) {
      throw new Error('invalid feedback event: type=' + type + ' value=' + value);
    }
    if (!itemId || !editionDate) {
      throw new Error('feedback event needs item_id and edition_date');
    }
    // Key order matches the canonical schema exactly.
    var ev = {
      ts: new Date().toISOString(),
      type: type,
      value: value,
      item_id: itemId,
      edition_date: editionDate,
    };
    var raw = localStorage.getItem(KEY);
    raw = raw ? raw.replace(/\n$/, '') + '\n' + JSON.stringify(ev) : JSON.stringify(ev);
    localStorage.setItem(KEY, raw);
    return ev;
  }

  /* Latest event value for (itemId, type), or null if never recorded. */
  function lastFor(itemId, type) {
    var found = null;
    lines().forEach(function (line) {
      var ev;
      try { ev = JSON.parse(line); } catch (err) { return; }
      if (ev.item_id === itemId && ev.type === type) { found = ev.value; }
    });
    return found;
  }

  function count() {
    return lines().length;
  }

  /* Download the whole stream as me-feedback-YYYYMMDD.jsonl (screen-only path). */
  function exportJSONL() {
    var now = new Date();
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    var name = 'me-feedback-' + now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate()) + '.jsonl';
    var text = lines().join('\n') + (lines().length ? '\n' : '');
    var blob = new Blob([text], { type: 'application/x-ndjson' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    return name;
  }

  window.MEFeedback = {
    KEY: KEY,
    append: append,
    lines: lines,
    lastFor: lastFor,
    count: count,
    exportJSONL: exportJSONL,
  };
})();
