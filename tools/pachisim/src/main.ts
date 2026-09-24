import { CORE_VERSION } from '@ph/core';

const [command = 'help'] = process.argv.slice(2);
switch (command) {
  case 'version':
    console.log(`pachisim (core v${CORE_VERSION})`);
    break;
  default:
    console.log('usage: pachisim <version>');
}
