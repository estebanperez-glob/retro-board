// Heuristic "AI" text utilities: tokenization and sentiment (no external API).
const STOP_WORDS = new Set(('a an and are as at be but by for from has have how i if in is it its of on or ' +
  'that the this to was we what when where which who will with you our your their they them he she not no yes ' +
  'very just so than then too can could should would will shall may might must do does did done get got make ' +
  'made really about into over under again more most some such only own same s t don now').split(' '));

const POSITIVE_WORDS = new Set(('good great well awesome love loved excellent happy glad nice amazing better best ' +
  'win winning success successful improve improved improvement fast smooth clear helpful productive fun easy ' +
  'solid strong proud enjoy enjoyed efficient reliable fantastic perfect thanks thank appreciate appreciated ' +
  'like liked useful valuable quick robust').split(' '));
const NEGATIVE_WORDS = new Set(('bad worse worst hate hated sad angry upset mad frustrated frustrating slow ' +
  'blocked blocker bug bugs broken fail failed failure issue issues problem problems unclear confusing confused ' +
  'difficult hard delay delayed late overdue missing lost stuck tedious painful annoying poor weak unstable ' +
  'crash crashed error errors wrong struggle struggled lack lacked lacking').split(' '));

function tokenize(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9áéíóúüñ\s]/g, ' ').split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

function sentimentOf(text) {
  const words = String(text).toLowerCase().split(/[^a-z]+/);
  let score = 0;
  for (const w of words) {
    if (POSITIVE_WORDS.has(w)) score += 1;
    if (NEGATIVE_WORDS.has(w)) score -= 1;
  }
  return score > 0 ? 'positive' : score < 0 ? 'negative' : 'neutral';
}

module.exports = { tokenize, sentimentOf };
