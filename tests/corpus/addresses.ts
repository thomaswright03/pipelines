// A labelled evaluation set for the brokerage-site address rule (an
// address found on the agent's brokerage's site may only be used if it is
// that agent's own), scored by tests/heuristics-eval.test.ts.
//
// Provenance: SYNTHETIC agent/address pairs in the shapes brokerage staff
// directories use (first.last, flast, firstl, first only, shared inboxes,
// colleagues sharing a first or last name). Not real people. Extend it with
// anonymised real cases — see docs/measuring-rules.md.
//
// First run (2026-09-25), before any rule was changed for it: precision
// 92.3%, recall 96.0% — it accepted jdoe.team@/tnguyen.assistant@-style
// inboxes and rejected patricia.oneil@ for "Patricia O'Neil". Both were
// fixed, so this set now scores 100% and fresh (real) cases are needed for
// an independent measure.
//
// Round 14 (2026-10-05): the second batch (formerly "held-out", now
// `ADDRESS_DEV_2`) has been printed miss by miss on every CI run and fixed against,
// so it is scored as a second development batch. A genuinely unseen
// measure needs real cases (docs/measuring-rules.md).
//
// belongs: true  — the address is this agent's own.
// belongs: false — a colleague's, a shared inbox, or not identifiable as theirs.

export type LabelledAddress = { agent: string; email: string; belongs: boolean };

export const ADDRESS_CORPUS: LabelledAddress[] = [
  // Theirs
  { agent: "John Doe", email: "john.doe@homesmart.test", belongs: true },
  { agent: "John Doe", email: "jdoe@homesmart.test", belongs: true },
  { agent: "John Doe", email: "johndoe@homesmart.test", belongs: true },
  { agent: "John Doe", email: "doej@homesmart.test", belongs: true },
  { agent: "John Doe", email: "john_doe@homesmart.test", belongs: true },
  { agent: "Maria Garcia", email: "maria.garcia@kw.test", belongs: true },
  { agent: "Maria Garcia", email: "mgarcia@kw.test", belongs: true },
  { agent: "Maria Garcia", email: "garcia.maria@kw.test", belongs: true },
  { agent: "Maria Garcia", email: "mgarcia2@kw.test", belongs: true },
  { agent: "Robert Chen", email: "robert.chen@remax.test", belongs: true },
  { agent: "Robert Chen", email: "rchen@remax.test", belongs: true },
  { agent: "Ann Lee", email: "ann.lee@cb.test", belongs: true },
  { agent: "Ann Lee", email: "alee@cb.test", belongs: true },
  { agent: "Ann Lee", email: "annlee@cb.test", belongs: true },
  { agent: "Patricia O'Neil", email: "patricia.oneil@exp.test", belongs: true },
  { agent: "Patricia O'Neil", email: "poneil@exp.test", belongs: true },
  { agent: "Luis Hernandez-Ruiz", email: "lhernandezruiz@exp.test", belongs: true },
  { agent: "Luis Hernandez-Ruiz", email: "luis.hernandez@exp.test", belongs: true },
  { agent: "Samantha J. Price", email: "sjprice@realty.test", belongs: true },
  { agent: "Samantha J. Price", email: "samantha.price@realty.test", belongs: true },
  { agent: "Kevin Brooks Jr.", email: "kevin.brooks@realty.test", belongs: true },
  { agent: "Dana Whitfield", email: "dana.whitfield+homes@realty.test", belongs: true },
  { agent: "Tom Nguyen", email: "tom.nguyen@kw.test", belongs: true },
  { agent: "Tom Nguyen", email: "tnguyen@kw.test", belongs: true },
  { agent: "Beth Anderson", email: "banderson@remax.test", belongs: true },

  // Not theirs
  { agent: "John Doe", email: "john.smith@homesmart.test", belongs: false },
  { agent: "John Doe", email: "johnson@homesmart.test", belongs: false },
  { agent: "John Doe", email: "john@homesmart.test", belongs: false },
  { agent: "John Doe", email: "doe.family@homesmart.test", belongs: false },
  { agent: "John Doe", email: "jane.doe@homesmart.test", belongs: false },
  { agent: "John Doe", email: "info@homesmart.test", belongs: false },
  { agent: "Ann Lee", email: "fleetsales@cb.test", belongs: false },
  { agent: "Ann Lee", email: "lee@cb.test", belongs: false },
  { agent: "Ann Lee", email: "annie@cb.test", belongs: false },
  { agent: "Ann Lee", email: "ann.leeson@cb.test", belongs: false },
  { agent: "Maria Garcia", email: "maria@kw.test", belongs: false },
  { agent: "Maria Garcia", email: "garciateam@kw.test", belongs: false },
  { agent: "Maria Garcia", email: "carlos.garcia@kw.test", belongs: false },
  { agent: "Maria Garcia", email: "frontdesk@kw.test", belongs: false },
  { agent: "Robert Chen", email: "robertson@remax.test", belongs: false },
  { agent: "Robert Chen", email: "bchen@remax.test", belongs: false },
  { agent: "Robert Chen", email: "chen.office@remax.test", belongs: false },
  { agent: "Tom Nguyen", email: "tommy@kw.test", belongs: false },
  { agent: "Tom Nguyen", email: "nguyen.team@kw.test", belongs: false },
  { agent: "Tom Nguyen", email: "tnguyen.assistant@kw.test", belongs: false },
  { agent: "Beth Anderson", email: "sanderson@remax.test", belongs: false },
  { agent: "Beth Anderson", email: "bethany@remax.test", belongs: false },
  { agent: "Beth Anderson", email: "leads@remax.test", belongs: false },
  { agent: "Dana Whitfield", email: "danaw@realty.test", belongs: false },
  { agent: "Kevin Brooks Jr.", email: "kbrooks.team@realty.test", belongs: false },
];

// --- Held-out split ------------------------------------------------------
// Written on 2026-09-25 after the rule was last changed and scored once
// as-is; never used when changing the rule (see replies.ts for the policy).
// First run (2026-09-25): precision 100%, recall 100%. Round 6: grown to 50
// with fresh cases, scored as-is — precision 100%, recall 96.0% (rejected
// annemarie.dupont@ for "Anne-Marie Dupont").
export const ADDRESS_DEV_2: LabelledAddress[] = [
  { agent: "Carla Mendez", email: "carla.mendez@homesmart.test", belongs: true },
  { agent: "Carla Mendez", email: "cmendez@homesmart.test", belongs: true },
  { agent: "Carla Mendez", email: "carlamendez@homesmart.test", belongs: true },
  { agent: "Greg O'Brien", email: "greg.obrien@exp.test", belongs: true },
  { agent: "Greg O'Brien", email: "gobrien@exp.test", belongs: true },
  { agent: "Nina Patel-Shah", email: "npatelshah@kw.test", belongs: true },
  { agent: "Nina Patel-Shah", email: "nina.patel@kw.test", belongs: true },
  { agent: "William Scott", email: "william.scott@remax.test", belongs: true },
  { agent: "William Scott", email: "wscott@remax.test", belongs: true },
  { agent: "Hannah Kim", email: "hkim@cb.test", belongs: true },
  { agent: "Carla Mendez", email: "carla@homesmart.test", belongs: false },
  { agent: "Carla Mendez", email: "mendezteam@homesmart.test", belongs: false },
  { agent: "Carla Mendez", email: "luis.mendez@homesmart.test", belongs: false },
  { agent: "Greg O'Brien", email: "office@exp.test", belongs: false },
  { agent: "Greg O'Brien", email: "gregory.brown@exp.test", belongs: false },
  { agent: "Nina Patel-Shah", email: "raj.patel@kw.test", belongs: false },
  { agent: "William Scott", email: "bill@remax.test", belongs: false },
  { agent: "William Scott", email: "scott.properties@remax.test", belongs: false },
  { agent: "Hannah Kim", email: "kim.team@cb.test", belongs: false },
  { agent: "Hannah Kim", email: "hkim.assistant@cb.test", belongs: false },
  // Fresh batch, 2026-09-25 (round 6), written before scoring and scored as-is.
  { agent: "Derek Johnson", email: "derek.johnson@realtyone.test", belongs: true },
  { agent: "Derek Johnson", email: "djohnson@realtyone.test", belongs: true },
  { agent: "Derek Johnson", email: "derekjohnson@realtyone.test", belongs: true },
  { agent: "Derek Johnson", email: "johnsond@realtyone.test", belongs: true },
  { agent: "Sofia Alvarez", email: "sofia.alvarez@westusa.test", belongs: true },
  { agent: "Sofia Alvarez", email: "salvarez@westusa.test", belongs: true },
  { agent: "Sofia Alvarez", email: "sofia_alvarez@westusa.test", belongs: true },
  { agent: "Michael McAllister", email: "michael.mcallister@russlyon.test", belongs: true },
  { agent: "Michael McAllister", email: "mmcallister@russlyon.test", belongs: true },
  { agent: "Priya Raman", email: "priya.raman@redfin.test", belongs: true },
  { agent: "Priya Raman", email: "praman@redfin.test", belongs: true },
  { agent: "Tom Nguyen", email: "tom.nguyen@exp.test", belongs: true },
  { agent: "Tom Nguyen", email: "tnguyen@exp.test", belongs: true },
  { agent: "Anne-Marie Dupont", email: "annemarie.dupont@cb.test", belongs: true },
  { agent: "Anne-Marie Dupont", email: "adupont@cb.test", belongs: true },
  { agent: "Derek Johnson", email: "info@realtyone.test", belongs: false },
  { agent: "Derek Johnson", email: "sarah.johnson@realtyone.test", belongs: false },
  { agent: "Derek Johnson", email: "derek.miller@realtyone.test", belongs: false },
  { agent: "Derek Johnson", email: "johnsonteam@realtyone.test", belongs: false },
  { agent: "Sofia Alvarez", email: "frontdesk@westusa.test", belongs: false },
  { agent: "Sofia Alvarez", email: "salvarez.team@westusa.test", belongs: false },
  { agent: "Sofia Alvarez", email: "carlos.alvarez@westusa.test", belongs: false },
  { agent: "Michael McAllister", email: "mike@russlyon.test", belongs: false },
  { agent: "Michael McAllister", email: "listings@russlyon.test", belongs: false },
  { agent: "Priya Raman", email: "anand.raman@redfin.test", belongs: false },
  { agent: "Priya Raman", email: "support@redfin.test", belongs: false },
  { agent: "Tom Nguyen", email: "tnguyen.assistant@exp.test", belongs: false },
  { agent: "Tom Nguyen", email: "linh.nguyen@exp.test", belongs: false },
  { agent: "Anne-Marie Dupont", email: "marie@cb.test", belongs: false },
  { agent: "Anne-Marie Dupont", email: "recruiting@cb.test", belongs: false },
];
