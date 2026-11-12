/** Keep the native overview intact while adding the shared subject illustration. */
function enhanceWritingHero() {
  if (!document.documentElement.classList.contains('host-embedded')) return;
  for (const hero of document.querySelectorAll('.hero')) {
    if (!hero.querySelector('.hero-copy') || hero.querySelector('.writing-hero-illustration')) continue;
    hero.classList.add('writing-subject-hero');
    const figure = document.createElement('div');
    figure.className = 'writing-hero-illustration';
    figure.setAttribute('aria-hidden', 'true');
    const image = document.createElement('img');
    image.src = '/subject-art/writing-paper.svg';
    image.alt = '';
    image.width = 390;
    image.height = 310;
    image.decoding = 'async';
    figure.append(image);
    hero.append(figure);
  }
}
const root = document.getElementById('root');
if (root) {
  const observer = new MutationObserver(enhanceWritingHero);
  observer.observe(root, { childList: true, subtree: true });
  enhanceWritingHero();
}
