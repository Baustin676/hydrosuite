const assert = require('assert');
const fs = require('fs');
const path = require('path');

const page = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const embed = fs.readFileSync(path.join(__dirname, '../embed/pumpresource-hydrosuite-pro.html'), 'utf8');

assert.ok(page.indexOf("type: 'hydrosuite:height'") > 0);
assert.ok(page.indexOf('https://pumpresource.us') > 0);
assert.ok(page.indexOf('https://www.pumpresource.us') > 0);
assert.ok(page.indexOf('ResizeObserver') > 0);
assert.ok(page.indexOf('html.embedded') > 0);
assert.ok(page.indexOf("type: 'hydrosuite:scroll-to-results'") > 0);
assert.ok(page.indexOf("targetOrigin") < 0);
assert.ok(page.indexOf("'*'") < 0);

assert.ok(embed.indexOf("setAttribute('scrolling', 'no')") > 0);
assert.ok(embed.indexOf("minHeight = '640px'") > 0);
assert.ok(embed.indexOf('width: 100%') > 0);
assert.ok(embed.indexOf('height="860"') < 0);
assert.ok(embed.indexOf('height: 900px') < 0);
assert.ok(embed.indexOf("var SOURCE = 'https://baustin676.github.io';") > 0);
assert.ok(embed.indexOf("ev.origin !== SOURCE") > 0);
assert.ok(embed.indexOf('hydrosuite:height') > 0);
assert.ok(embed.indexOf('hydrosuite:scroll-to-results') > 0);
assert.ok(embed.indexOf('hydrosuite:download') > 0);
assert.ok(embed.indexOf('hydrosuite:ready') > 0);
assert.ok(embed.indexOf('web-share') > 0);
assert.ok(embed.indexOf("'*'") < 0);
assert.ok(embed.indexOf("setAttribute('aria-label', 'Dean Pump Selector')") > 0);
assert.ok(embed.indexOf('Dean RA Pump Selector') < 0);
assert.ok(embed.indexOf('Open Full Screen') > 0);
assert.ok(embed.indexOf('function openFullscreen()') > 0);
assert.ok(embed.indexOf("wrap.style.overflow = 'auto'") > 0);
assert.ok(embed.indexOf("bar.style.position = 'sticky'") > 0);

console.log('embed-frame tests passed');
