// scripts/install.mjs —— 把 dsh-prompt-refine 装进指定 DSH profile
//
// 用法:
//   node scripts/install.mjs --profile web         # 装到单个 profile
//   node scripts/install.mjs --all                 # 装到所有 profile
//   node scripts/install.mjs --profile web --remove  # 从 web 卸载

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PLUGIN_PATH = dirname(__dirname)

const PROFILE_DIR = process.env.DSH_HOME ?? join(process.env.USERPROFILE ?? process.env.HOME, '.dsh')
const ALL_PROFILES = ['desktop', 'web', 'open-design']

function parseArgs(argv) {
  const args = { profile: null, all: false, remove: false, help: false }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--profile') args.profile = argv[++i]
    else if (a === '--all') args.all = true
    else if (a === '--remove') args.remove = true
    else if (a === '--help' || a === '-h') args.help = true
  }
  return args
}

function usage() {
  console.log(`用法:
  node scripts/install.mjs --profile <name>            安装到指定 profile
  node scripts/install.mjs --all                        安装到所有 profile
  node scripts/install.mjs --profile <name> --remove   从指定 profile 卸载

可用 profile: ${ALL_PROFILES.join(', ')}`)
}

function listProfiles() {
  return ALL_PROFILES.filter((n) => existsSync(join(PROFILE_DIR, 'profiles', n, 'package.json')))
}

function applyProfile(profileName, remove) {
  const pkgPath = join(PROFILE_DIR, 'profiles', profileName, 'package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  const deps = pkg.dependencies ?? {}
  const dshProfile = pkg.dsh?.profile ?? {}
  const bundles = dshProfile.bundles ?? []

  if (remove) {
    let changed = false
    if (deps['dsh-prompt-refine']) {
      delete deps['dsh-prompt-refine']
      changed = true
    }
    const idx = bundles.indexOf('dsh-prompt-refine')
    if (idx >= 0) {
      bundles.splice(idx, 1)
      changed = true
    }
    if (changed) {
      pkg.dependencies = deps
      pkg.dsh = pkg.dsh ?? {}
      pkg.dsh.profile = dshProfile
      pkg.dsh.profile.bundles = bundles
      writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
      console.log(`  ✓ 已从 ${profileName} 卸载`)
    } else {
      console.log(`  - ${profileName} 本来就没装`)
    }
  } else {
    deps['dsh-prompt-refine'] = `file:${PLUGIN_PATH}`
    if (!bundles.includes('dsh-prompt-refine')) bundles.push('dsh-prompt-refine')
    pkg.dependencies = deps
    pkg.dsh = pkg.dsh ?? {}
    pkg.dsh.profile = dshProfile
    pkg.dsh.profile.bundles = bundles
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
    console.log(`  ✓ 已装到 ${profileName}`)
  }
}

const args = parseArgs(process.argv)
if (args.help || (!args.profile && !args.all)) {
  usage()
  process.exit(args.help ? 0 : 1)
}

const targets = args.all ? listProfiles() : [args.profile]
for (const name of targets) {
  if (!existsSync(join(PROFILE_DIR, 'profiles', name))) {
    console.warn(`! ${name} 不存在,跳过`)
    continue
  }
  applyProfile(name, args.remove)
}
console.log('完成。')