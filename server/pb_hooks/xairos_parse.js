// GENERATED from src/server/hooks-entry.ts by `npm run build:hooks`. Do not edit.
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
// src/lib/dates.ts
var pad = (n) => String(n).padStart(2, "0");
var ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
var parseYmd = (s) => {
	const [y, m, d] = s.split("-").map(Number);
	return new Date(y, m - 1, d);
};
var addDays = (d, n) => {
	const x = new Date(d);
	x.setDate(x.getDate() + n);
	return x;
};
var todayD = () => {
	const d = /* @__PURE__ */ new Date();
	d.setHours(0, 0, 0, 0);
	return d;
};
var dayDiff = (s) => Math.round((parseYmd(s).getTime() - todayD().getTime()) / 864e5);
var DOW = [
	"Sun",
	"Mon",
	"Tue",
	"Wed",
	"Thu",
	"Fri",
	"Sat"
];
var MON = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec"
];
function fmtTime(t) {
	if (!t) return "";
	const [hh, mm] = t.split(":").map(Number);
	return `${hh % 12 || 12}:${pad(mm)}${hh < 12 ? " AM" : " PM"}`;
}
function fmtDue(due, time) {
	if (!due) return "";
	const n = dayDiff(due), d = parseYmd(due);
	let s;
	if (n === 0) s = "Today";
	else if (n === 1) s = "Tomorrow";
	else if (n === -1) s = "Yesterday";
	else if (n > 1 && n < 7) s = DOW[d.getDay()];
	else s = `${MON[d.getMonth()]} ${d.getDate()}` + (d.getFullYear() !== todayD().getFullYear() ? `, ${d.getFullYear()}` : "");
	return time ? `${s}, ${fmtTime(time)}` : s;
}
var nextMonday = (today = todayD()) => ymd(addDays(today, (8 - today.getDay()) % 7 || 7));
// src/recurrence.ts
/** Add n months, clamping to the month's last day (Jan 31 + 1 month = Feb 28/29). */
function addMonthsClamp(d, n, dom) {
	const y = d.getFullYear(), m = d.getMonth() + n;
	const last = new Date(y, m + 1, 0).getDate();
	return new Date(y, m, Math.min(dom || d.getDate(), last));
}
/** The occurrence after `fromYmd` for this rule. */
function nextDue(rule, fromYmd) {
	const d = parseYmd(fromYmd), iv = Math.max(1, rule.interval || 1);
	switch (rule.freq) {
		case "daily": return ymd(addDays(d, iv));
		case "weekly": {
			var _rule$byDay;
			const days = ((_rule$byDay = rule.byDay) === null || _rule$byDay === void 0 ? void 0 : _rule$byDay.length) ? rule.byDay : [d.getDay()];
			const weekStart = (x) => addDays(x, -x.getDay()).getTime();
			for (let i = 1; i <= 7; i++) {
				const c = addDays(d, i);
				if (days.includes(c.getDay())) return ymd(weekStart(c) !== weekStart(d) ? addDays(c, (iv - 1) * 7) : c);
			}
			return ymd(addDays(d, 7 * iv));
		}
		case "monthly": return ymd(addMonthsClamp(d, iv, rule.dom));
		case "yearly": return ymd(addMonthsClamp(d, 12 * iv, rule.dom));
	}
	return ymd(addDays(d, 1));
}
function repeatLabel(r) {
	if (!r) return "";
	const iv = r.interval || 1, days = (r.byDay || []).slice().sort();
	let s;
	if (r.freq === "daily") s = iv === 1 ? "Daily" : `Every ${iv} days`;
	else if (r.freq === "weekly") {
		if (iv === 1 && days.join() === "1,2,3,4,5") s = "Weekdays";
		else s = (iv === 1 ? "Weekly" : `Every ${iv} weeks`) + (days.length ? " on " + days.map((x) => DOW[x]).join(", ") : "");
	} else if (r.freq === "monthly") s = (iv === 1 ? "Monthly" : `Every ${iv} months`) + (r.dom ? ` on day ${r.dom}` : "");
	else s = iv === 1 ? "Yearly" : `Every ${iv} years`;
	if (r.from === "completion") s += " (after completion)";
	if (r.until) s += `, until ${fmtDue(r.until)}`;
	return s;
}
/** First date (today or later) the rule lands on. */
function firstOccurrence(rule, today = todayD()) {
	var _rule$byDay2;
	const t0 = today;
	if (rule.freq === "weekly" && ((_rule$byDay2 = rule.byDay) === null || _rule$byDay2 === void 0 ? void 0 : _rule$byDay2.length)) for (let i = 0; i < 7; i++) {
		const c = addDays(t0, i);
		if (rule.byDay.includes(c.getDay())) return ymd(c);
	}
	return ymd(t0);
}
/** Where a repeating task moves when completed on `today`. `finished` means the series ends. */
function advanceRepeat(rule, due, today) {
	let next = nextDue(rule, rule.from === "completion" ? today : due);
	if (rule.from !== "completion") while (next < today && next < (rule.until || "9999")) next = nextDue(rule, next);
	const finished = !!(rule.until && next > rule.until) || !!(rule.count && (rule.done || 0) + 1 >= rule.count);
	return {
		next,
		finished
	};
}
// src/parser.ts
var WD = {
	sun: 0,
	mon: 1,
	tue: 2,
	wed: 3,
	thu: 4,
	fri: 5,
	sat: 6
};
var wdOf = (w) => WD[w.toLowerCase().slice(0, 3)];
var WDRE = "(?:sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?)";
var PRI = {
	high: 5,
	"3": 5,
	med: 3,
	medium: 3,
	"2": 3,
	low: 1,
	"1": 1,
	none: 0,
	"0": 0
};
/**
* Parse a quick-add line like "Pay rent every month 9am !high #home ^Bills".
* `today` (local midnight) anchors relative dates; the server passes the
* user's date, since its own clock may be in another zone.
*/
function parseQuick(raw, today = todayD()) {
	let s = " " + raw + " ";
	const out = {
		title: "",
		due: null,
		time: null,
		priority: null,
		tags: [],
		listName: null,
		repeat: null,
		chips: []
	};
	const take = (re, fn) => {
		s = s.replace(re, (...m) => fn(...m) === false ? m[0] : " ");
	};
	take(/\s!(high|med|medium|low|none|[0-3])(?=\s)/i, (_, p) => {
		out.priority = PRI[p.toLowerCase()];
	});
	take(/\s#([\w-]+)(?=\s)/g, (_, t) => {
		out.tags.push(t.toLowerCase());
	});
	take(/\s\^([\w-]+)(?=\s)/, (_, l) => {
		out.listName = l;
	});
	take(/\severy\s+weekdays?(?=\s)/i, () => {
		out.repeat = {
			freq: "weekly",
			interval: 1,
			byDay: [
				1,
				2,
				3,
				4,
				5
			]
		};
	});
	if (!out.repeat) take(/\s(?:every\s+day|daily)(?=\s)/i, () => {
		out.repeat = {
			freq: "daily",
			interval: 1
		};
	});
	if (!out.repeat) take(/\severy\s+(\d{1,3})\s+(day|days|week|weeks|month|months|year|years)(?=\s)/i, (_, n, u) => {
		const f = u.startsWith("day") ? "daily" : u.startsWith("week") ? "weekly" : u.startsWith("month") ? "monthly" : "yearly";
		out.repeat = {
			freq: f,
			interval: +n
		};
	});
	if (!out.repeat) take(/\s(?:every\s+month|monthly)(?=\s)/i, () => {
		out.repeat = {
			freq: "monthly",
			interval: 1
		};
	});
	if (!out.repeat) take(/\s(?:every\s+year|yearly|annually)(?=\s)/i, () => {
		out.repeat = {
			freq: "yearly",
			interval: 1
		};
	});
	if (!out.repeat) take(new RegExp("\\severy\\s+(" + WDRE + "(?:\\s*(?:,|and)\\s*" + WDRE + ")*)(?=\\s)", "i"), (_, list) => {
		out.repeat = {
			freq: "weekly",
			interval: 1,
			byDay: [...new Set(list.split(/\s*(?:,|and)\s*/i).map(wdOf))].sort()
		};
	});
	if (!out.repeat) take(/\s(?:every\s+week|weekly)(?=\s)/i, () => {
		out.repeat = {
			freq: "weekly",
			interval: 1
		};
	});
	take(/\s(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)(?=\s)/i, (_, hh, mm, ap) => {
		const h = +hh % 12 + (ap.toLowerCase() === "pm" ? 12 : 0);
		out.time = `${pad(h)}:${pad(+(mm || 0))}`;
	});
	if (!out.time) take(/\s(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)(?=\s)/, (_, hh, mm) => {
		out.time = `${pad(+hh)}:${mm}`;
	});
	if (!out.time) take(/\sat\s+(\d{1,2})(?=\s)/i, (_, hh) => {
		if (+hh > 23) return false;
		out.time = `${pad(+hh)}:00`;
	});
	const t0 = new Date(today);
	t0.setHours(0, 0, 0, 0);
	take(/\s(today|tod)(?=\s)/i, () => {
		out.due = ymd(t0);
	});
	if (!out.due) take(/\s(tomorrow|tmr|tmrw)(?=\s)/i, () => {
		out.due = ymd(addDays(t0, 1));
	});
	if (!out.due) take(/\snext\s+week(?=\s)/i, () => {
		out.due = nextMonday(t0);
	});
	if (!out.due) take(/\sin\s+(\d{1,3})\s+(day|days|week|weeks)(?=\s)/i, (_, n, u) => {
		out.due = ymd(addDays(t0, +n * (u.startsWith("week") ? 7 : 1)));
	});
	if (!out.due) take(new RegExp("\\s(?:on\\s+|next\\s+)?(" + WDRE + ")(?=\\s)", "i"), (_, w) => {
		let n = (wdOf(w) - t0.getDay() + 7) % 7;
		if (n === 0) n = 7;
		out.due = ymd(addDays(t0, n));
	});
	if (!out.due) take(/\s(?:on\s+)?(\d{1,2})\/(\d{1,2})(?=\s)/, (_, ms, ds) => {
		const m = +ms, d = +ds;
		if (m < 1 || m > 12 || d < 1 || d > 31) return false;
		const c = new Date(t0.getFullYear(), m - 1, d);
		if (c < t0) c.setFullYear(c.getFullYear() + 1);
		out.due = ymd(c);
	});
	if (!out.due) take(/\s(?:on\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})(?=\s)/i, (_, m, d) => {
		const mi = MON.findIndex((x) => x.toLowerCase() === m.toLowerCase().slice(0, 3));
		const c = new Date(t0.getFullYear(), mi, +d);
		if (c < t0) c.setFullYear(c.getFullYear() + 1);
		out.due = ymd(c);
	});
	const rep = out.repeat;
	if (rep) {
		if (!out.due) out.due = firstOccurrence(rep, t0);
		if (rep.freq === "weekly" && !rep.byDay) rep.byDay = [parseYmd(out.due).getDay()];
		rep.dom = parseYmd(out.due).getDate();
		rep.from = "due";
	}
	if (out.time && !out.due) out.due = ymd(t0);
	out.title = s.replace(/\s+/g, " ").trim();
	if (out.due) out.chips.push({
		cls: "",
		txt: fmtDue(out.due, out.time)
	});
	if (rep) out.chips.push({
		cls: "",
		txt: "↻ " + repeatLabel(rep)
	});
	if (out.priority) out.chips.push({
		cls: "pri-" + out.priority,
		txt: {
			5: "High",
			3: "Medium",
			1: "Low"
		}[out.priority]
	});
	out.tags.forEach((t) => out.chips.push({
		cls: "",
		txt: "#" + t
	}));
	if (out.listName) out.chips.push({
		cls: "",
		txt: "^" + out.listName
	});
	return out;
}
exports.advanceRepeat = advanceRepeat;
exports.parseQuick = parseQuick;
