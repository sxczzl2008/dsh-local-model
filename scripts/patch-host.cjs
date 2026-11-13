const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_HOME = process.env.DSH_HOME || (fs.existsSync('E:/DSH/home/profiles/desktop') ? 'E:/DSH/home' : path.join(os.homedir(), '.dsh'));

function parseArgs(argv) {
  const out = { action: 'install', homeDir: DEFAULT_HOME };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--install') out.action = 'install';
    else if (a === '--uninstall') out.action = 'uninstall';
    else if (a === '--home' && argv[i + 1]) out.homeDir = path.resolve(argv[++i]);
  }
  return out;
}

function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirRecursive(s, d);
    else fs.copyFileSync(s, d);
  }
}

function installToProfile(homeDir) {
  const desktopDir = path.join(homeDir, 'profiles/desktop');
  if (!fs.existsSync(desktopDir)) {
    throw new Error(`未找到 DSH desktop profile 目录: ${desktopDir}`);
  }

  const pkgDest = path.join(desktopDir, 'node_modules/dsh-local-model');
  fs.rmSync(pkgDest, { recursive: true, force: true });
  fs.mkdirSync(pkgDest, { recursive: true });
  for (const f of ['package.json', 'cordis.patch.yml', 'README.md', 'CHANGELOG.md']) {
    const srcFile = path.join(REPO_ROOT, f);
    if (fs.existsSync(srcFile)) fs.copyFileSync(srcFile, path.join(pkgDest, f));
  }
  copyDirRecursive(path.join(REPO_ROOT, 'lib'), path.join(pkgDest, 'lib'));
  copyDirRecursive(path.join(REPO_ROOT, 'scripts'), path.join(pkgDest, 'scripts'));

  const desktopPkgFile = path.join(desktopDir, 'package.json');
  if (fs.existsSync(desktopPkgFile)) {
    const pkg = JSON.parse(fs.readFileSync(desktopPkgFile, 'utf8'));
    pkg.dependencies = pkg.dependencies || {};
    delete pkg.dependencies['dsh-local-model-control'];
    pkg.dependencies['dsh-local-model'] = '0.1.0';
    pkg.dsh = pkg.dsh || {};
    pkg.dsh.profile = pkg.dsh.profile || {};
    const bundles = Array.isArray(pkg.dsh.profile.bundles) ? pkg.dsh.profile.bundles : [];
    pkg.dsh.profile.bundles = bundles.filter(b => b !== 'dsh-local-model-control');
    if (!pkg.dsh.profile.bundles.includes('dsh-local-model')) {
      pkg.dsh.profile.bundles.push('dsh-local-model');
    }
    fs.writeFileSync(desktopPkgFile, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  }

  const cordisFile = path.join(desktopDir, 'cordis.yml');
  if (fs.existsSync(cordisFile)) {
    let yml = fs.readFileSync(cordisFile, 'utf8');
    yml = yml.replace(/\r?\n\s*-\s*id:\s*local-model-control[\s\S]*?name:\s*dsh-local-model(?:-control)?(\r?\n\s*config:[\s\S]*?(?=\r?\n\s*-\s*id:|$))?/g, '');
    fs.writeFileSync(cordisFile, yml.trimEnd() + '\n', 'utf8');
  }

  return { desktopDir, pkgDest, desktopPkgFile };
}

function uninstallFromProfile(homeDir) {
  const desktopDir = path.join(homeDir, 'profiles/desktop');
  const pkgDest = path.join(desktopDir, 'node_modules/dsh-local-model');
  if (fs.existsSync(pkgDest)) fs.rmSync(pkgDest, { recursive: true, force: true });

  const desktopPkgFile = path.join(desktopDir, 'package.json');
  if (fs.existsSync(desktopPkgFile)) {
    const pkg = JSON.parse(fs.readFileSync(desktopPkgFile, 'utf8'));
    if (pkg.dependencies) {
      delete pkg.dependencies['dsh-local-model'];
      delete pkg.dependencies['dsh-local-model-control'];
    }
    if (pkg.dsh?.profile?.bundles && Array.isArray(pkg.dsh.profile.bundles)) {
      pkg.dsh.profile.bundles = pkg.dsh.profile.bundles.filter(
        b => b !== 'dsh-local-model' && b !== 'dsh-local-model-control'
      );
    }
    fs.writeFileSync(desktopPkgFile, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  }

  const cordisFile = path.join(desktopDir, 'cordis.yml');
  if (fs.existsSync(cordisFile)) {
    let yml = fs.readFileSync(cordisFile, 'utf8');
    yml = yml.replace(/\r?\n\s*-\s*id:\s*local-model-control[\s\S]*?name:\s*dsh-local-model(?:-control)?(\r?\n\s*config:[\s\S]*?(?=\r?\n\s*-\s*id:|$))?/g, '');
    fs.writeFileSync(cordisFile, yml.trimEnd() + '\n', 'utf8');
  }
  return { desktopDir };
}

function main() {
  const opts = parseArgs(process.argv);
  if (opts.action === 'install') {
    const res = installToProfile(opts.homeDir);
    console.log(JSON.stringify({ ok: true, action: 'install', ...res }, null, 2));
  } else {
    const res = uninstallFromProfile(opts.homeDir);
    console.log(JSON.stringify({ ok: true, action: 'uninstall', ...res }, null, 2));
  }
}

main();
