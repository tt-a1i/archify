const REQUIRED_DISCLOSURES = [
  ['Simple Icons pinned version', 'Simple Icons 16.28.0'],
  ['Simple Icons pinned source', 'https://github.com/simple-icons/simple-icons/tree/16.28.0'],
  ['Simple Icons collection license', 'https://github.com/simple-icons/simple-icons/blob/16.28.0/LICENSE.md'],
  ['Simple Icons disclaimer', 'https://github.com/simple-icons/simple-icons/blob/16.28.0/DISCLAIMER.md'],
  ['individual-license boundary', 'The absence\nof an individual license entry is not a grant of permission.'],
  ['vector-path and color treatment', 'Archify embeds the selected icons as vector-path data and may render them in a\nuser-selected color.'],
  ['Angular source', 'https://angular.dev/press-kit'],
  ['Angular license', 'CC-BY-4.0'],
  ['Apache Airflow mark', '| Apache Airflow |'],
  ['Apache Kafka mark', '| Apache Kafka |'],
  ['Apache source', 'https://apache.org/logos'],
  ['Apache license', 'Apache-2.0'],
  ['ASF trademark policy', 'https://www.apache.org/foundation/marks/'],
  ['.NET source', 'https://github.com/dotnet/brand/blob/c7d0f51b8ec59531332d05fb27a5b758a7a3d689/logo/dotnet-logo.svg'],
  ['.NET license', 'CC0-1.0'],
  ['JavaScript source', 'https://github.com/voodootikigod/logo.js/blob/1544bdeed6d618a6cfe4f0650d04ab8d9cfa76d9/js.svg'],
  ['JavaScript license', 'https://github.com/voodootikigod/logo.js/blob/1544bdeed6d618a6cfe4f0650d04ab8d9cfa76d9/LICENSE'],
  ['Jenkins source', 'https://get.jenkins.io/art/'],
  ['Jenkins license', 'CC-BY-SA-3.0'],
  ['Rust source', 'https://www.rust-lang.org'],
  ['Rust license', 'CC-BY-SA-4.0'],
  ['Rust media guide', 'https://www.rust-lang.org/policies/media-guide'],
  ['Vue source', 'https://github.com/vuejs/art/blob/a1c78b74569b70a25300925b4eacfefcc143b8f6/logo.svg'],
  ['Vue license', 'CC-BY-NC-SA-4.0'],
  ['Vue artwork terms', 'https://github.com/vuejs/art/blob/a1c78b74569b70a25300925b4eacfefcc143b8f6/README.md'],
  ['OpenAI section', '## OpenAI mark'],
  ['OpenAI source', 'https://openai.com/brand/'],
  ['OpenAI provenance boundary', 'not from Simple Icons'],
  ['no endorsement by OpenAI', 'does not state or imply endorsement by OpenAI'],
  ['general no-endorsement statement', 'does not imply sponsorship, endorsement, partnership,\nor affiliation with Archify'],
  ['third-party rights boundary', 'does not\nreplace the copyright licenses, trademark policies, or brand guidelines'],
  ['ownership statement', 'Brand names, logos, and trademarks remain the property of their respective\nowners.'],
  ['no additional rights statement', 'does not grant rights\nthat Archify does not hold'],
  ['clearance boundary', 'does not state that every packaged mark has\nbeen cleared for every commercial, promotional, or redistributive use'],
];

export function validateThirdPartyNotices(content) {
  if (typeof content !== 'string' || content.length === 0) {
    return { ok: false, missing: ['non-empty notice'] };
  }
  const missing = REQUIRED_DISCLOSURES
    .filter(([, fragment]) => !content.includes(fragment))
    .map(([label]) => label);
  return { ok: missing.length === 0, missing };
}

export function assertThirdPartyNotices(content, subject = 'THIRD_PARTY_NOTICES.md') {
  const result = validateThirdPartyNotices(content);
  if (!result.ok) {
    throw new Error(`${subject} is incomplete; missing required disclosure: ${result.missing.join(', ')}`);
  }
}

export const THIRD_PARTY_NOTICE_DISCLOSURE_COUNT = REQUIRED_DISCLOSURES.length;
