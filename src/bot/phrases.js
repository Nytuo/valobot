// Phrases du bot : français, mèmes et citations cultes (certaines en anglais)
const pick = (list) => list[Math.floor(Math.random() * list.length)];

const recruitment = [
  "« Il est où le 5ème ? » 🔎 On cherche des courageux pour se faire carry (ou pas).",
  "« Hello there. » 👋 Une party Valo se forme, soyez pas timides.",
  "« Ils sont où mes soldats ? » 🪖 Faut remplir la squad avant que Jett dash sans nous.",
  "« This is fine. » 🔥 La game va être un désastre, mais en équipe.",
  "« Avengers, assemble ! » 🦸 Même ceux qui jouent Sage."
];

const joined = [
  "{name} a rejoint la squad ! « It's free real estate » 🏠",
  "{name} débarque comme un Jett sans Op : « Sheeesh » 😎",
  "Un {name} sauvage apparaît ! « Stonks » 📈",
  "{name} est dans la place. « Hello there. » 🐸",
  "{name} rejoint la party. « Bienvenue dans la mif » 🫡"
];

const locked = [
  "⏳ **Deadline passée**, mais les retardataires sont acceptés jusqu'au début du match. « Better late than never » 🐌",
  "⏳ **Votes officiellement fermés**... mais on est pas des animaux, vous pouvez encore voter jusqu'au match. 🫡"
];

const lockedSquad = [
  "Squad prête ! Le match arrive : {mentions}",
  "« Let's go gambling ! » 🎰 C'est parti : {mentions}"
];

const cancelled = [
  "🛑 **Session annulée** par {who}. « Et c'est le drame » 🎭",
  "🛑 **Annulé** par {who}. « Nope. » 🚪🏃"
];

const flopTitles = [
  "💀 Flop total : pas assez de joueurs",
  "💀 Skill issue collective",
  "💀 « Et c'est le drame »"
];

const flopLines = [
  "Seulement **{n}/{size}** présents. Où étaient passés les autres ? Ils farment du Fortnite ?",
  "**{n}/{size}** joueurs... c'est pas une party, c'est une réunion de famille. 😭",
  "Il manque du monde (**{n}/{size}**). « C'est pas faux. » 🤷"
];

const reminders = [
  "Le match commence dans **{label}** ! « Réveille-toi, Samuel » ⏰",
  "Plus que **{label}** avant la game ! Vous votez ou on lance sans vous ? 😤",
  "**{label}** avant le match ! « Vous êtes où ? » 📢"
];

const statsBefore = [
  "Voilà où on en est avant de se faire (ou pas) carry. « Les stats ne mentent pas... » 📈",
  "Photo avant la game. On compare après, et on se moque de ceux qui descendent. 😈",
  "Le point de départ est posé. « Que le meilleur gagne. Spoiler : ce sera pas moi. » 🫠"
];

const statsAfter = [
  "Voici le bilan. « Je ne regrette rien. » (Menteur.) 🎤",
  "Les chiffres sont tombés. « C'est la faute du teamplay. » 🧾"
];

const mvp = [
  "👑 MVP de la soirée : {name} avec **{acs} ACS**. « Il a joué à un autre jeu. » 🐐",
  "👑 {name} a tout porté (**{acs} ACS**). « Carry mode: ON » 🔛"
];

const boulet = [
  "🥔 Boulet de service : {name} (**{acs} ACS**). « J'étais lag. » 📡",
  "🥔 {name} ferme la marche avec **{acs} ACS**. « Le sol, c'est mon spot préféré. » 🧎"
];

const voteAck = {
  sure: "🟢 Présent, sans excuse ! « Chaud patate » 🔥",
  maybe: "🟡 Un « peut-être »... qui sent le lapin. 🐇",
  if_last: "🟣 Dernier recours validé, le héros qu'on mérite. 🦇",
  backup: "🟠 Remplaçant noté, garde les crampons aux pieds. ⚽",
  no: "🔴 Lâche. Tu nous laisses tomber. « Noooon » 😢",
  remove: "🗑️ Vote effacé. On fait comme si de rien n'était. 🕵️"
};

module.exports = {
  pick,
  recruitment,
  joined,
  locked,
  lockedSquad,
  cancelled,
  flopTitles,
  flopLines,
  reminders,
  statsBefore,
  statsAfter,
  mvp,
  boulet,
  voteAck
};
