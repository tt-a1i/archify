(function () {
  const input = document.getElementById('wiki-search');
  const pages = Array.from(document.querySelectorAll('[data-wiki-page]'));
  const empty = document.getElementById('wiki-empty');
  input.addEventListener('input', function () {
    const query = input.value.toLocaleLowerCase().trim();
    let matches = 0;
    for (const page of pages) {
      page.hidden = !page.textContent.toLocaleLowerCase().includes(query);
      if (!page.hidden) matches += 1;
    }
    empty.hidden = matches > 0 || !query;
  });

  // A file:// hyperlink can navigate to text instead of downloading it.
  // Save the exact companion Markdown bytes through a local Blob.
  const download = document.getElementById('wiki-download');
  download.addEventListener('click', function (event) {
    event.preventDefault();
    const markdown = JSON.parse(document.getElementById('wiki-markdown').textContent);
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }));
    link.download = 'wiki.md';
    link.click();
    setTimeout(function () { URL.revokeObjectURL(link.href); }, 1000);
  });
})();
