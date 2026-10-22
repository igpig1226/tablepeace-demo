import {copyFileSync, mkdirSync} from 'node:fs';
import {join} from 'node:path';

mkdirSync('public', {recursive: true});
for (const name of ['index.html', 'styles.css', 'ocean.css', 'app.js', 'zh-live.js', 'favicon.svg']) {
  copyFileSync(name, join('public', name));
}
for (const name of ['motion.css', 'motion.js']) copyFileSync(join('docs', name), join('public', name));
