import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const fontsDir = path.resolve('assets/fonts');
if (!fs.existsSync(fontsDir)) {
  fs.mkdirSync(fontsDir, { recursive: true });
}

async function download(url, dest) {
  console.log(`Downloading ${url} -> ${dest}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.statusText}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buffer);
}

async function main() {
  // Direct files from google/fonts & googlefonts/noto-fonts
  const direct = [
    {
      url: 'https://raw.githubusercontent.com/googlefonts/noto-fonts/main/unhinted/ttf/NotoSansDevanagari/NotoSansDevanagari-Bold.ttf',
      dest: path.join(fontsDir, 'NotoSansDevanagari-Bold.ttf')
    },
    {
      url: 'https://raw.githubusercontent.com/googlefonts/noto-fonts/main/unhinted/ttf/NotoSansDevanagari/NotoSansDevanagari-ExtraBold.ttf',
      dest: path.join(fontsDir, 'NotoSansDevanagari-ExtraBold.ttf')
    },
    {
      url: 'https://raw.githubusercontent.com/googlefonts/noto-fonts/main/LICENSE',
      dest: path.join(fontsDir, 'NotoSansDevanagari-LICENSE.txt')
    },
    {
      url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/anton/Anton-Regular.ttf',
      dest: path.join(fontsDir, 'Anton-Regular.ttf')
    },
    {
      url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/anton/OFL.txt',
      dest: path.join(fontsDir, 'Anton-OFL.txt')
    },
    {
      url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/montserrat/Montserrat%5Bwght%5D.ttf',
      dest: path.join(fontsDir, 'Montserrat-ExtraBold.ttf')
    },
    {
      url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/montserrat/OFL.txt',
      dest: path.join(fontsDir, 'Montserrat-OFL.txt')
    },
    {
      url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/playfairdisplay/PlayfairDisplay%5Bwght%5D.ttf',
      dest: path.join(fontsDir, 'PlayfairDisplay-Bold.ttf')
    },
    {
      url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/playfairdisplay/OFL.txt',
      dest: path.join(fontsDir, 'PlayfairDisplay-OFL.txt')
    }
  ];

  for (const item of direct) {
    if (!fs.existsSync(item.dest) || fs.statSync(item.dest).size < 1000) {
      await download(item.url, item.dest);
    }
  }

  console.log('Fonts downloaded successfully:');
  fs.readdirSync(fontsDir).forEach(f => console.log(' - ' + f + ' (' + fs.statSync(path.join(fontsDir, f)).size + ' bytes)'));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
