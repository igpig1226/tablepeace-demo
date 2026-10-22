import {copyFileSync, mkdirSync} from 'node:fs';
import {join} from 'node:path';

mkdirSync('public', {recursive: true});
for (const name of ['index.html', 'styles.css', 'ocean.css', 'motion.css', 'app.js', 'zh-live.js', 'motion.js', 'favicon.svg']) {
  copyFileSync(name, join('public', name));
}
