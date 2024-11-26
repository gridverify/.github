// This script handles versioning of the project via the "build"
// and "version" keys in the package.json file. This does not
// handle any git operations.
// 
// NEED TO INSTALL FOLLOWING NPM PACKAGES: 
// • semver
// • simple-git
//
// This should usually be placed in the "bin" directory

const semver = require('semver')
const fs = require('fs')
const simpleGit = require('simple-git')
const git = simpleGit()

/**
 * Bumps the build key in the package.json file
 */
const bumpBuild = () => {
  const rawPkg = fs.readFileSync('package.json')
  const pkg = JSON.parse(rawPkg)
  const newBuildNumber = Number(pkg.build) + 1
  pkg.build = `${newBuildNumber}`
  const newRawPkg = JSON.stringify(pkg, null, 2)
  fs.writeFileSync('package.json', newRawPkg)
}

/**
 * Bump the version based on the position provided
 *
 * @param position String {patch, minor, major}
 */
const bumpVersion = (position) => {
  const rawPkg = fs.readFileSync('package.json')
  const pkg = JSON.parse(rawPkg)
  const currVer = pkg.version
  let newVer

  if (['patch', 'minor', 'major'].includes(position)) {
    newVer = semver.inc(currVer, position)
  } else {
    console.log('No changes made')
    process.exit(1)
    return
  }

  pkg.version = newVer
  const newRawPkg = JSON.stringify(pkg, null, 2)
  fs.writeFileSync('package.json', newRawPkg)
}

/**
 * Set the version number
 *
 * @param version String
 */
const setVersion = (version) => {
  const rawPkg = fs.readFileSync('package.json')
  const pkg = JSON.parse(rawPkg)
  pkg.version = version
  const newRawPkg = JSON.stringify(pkg, null, 2)
  fs.writeFileSync('package.json', newRawPkg)
}

// Read command line options
opts = process.argv.slice(2)
var isBuildBump = false
opt = opts[0]
switch (opt) {
	case '--bump-build':
	case '-bb':
		bumpBuild()
        isBuildBump = true
        break
	case '--bump-version-patch':
		bumpVersion('patch')
        break
	case '--bump-version-minor':
		bumpVersion('minor')
        break
	case '--bump-version-major':
		bumpVersion('major')
        break
	case '--set-version':
        if (opts.length == 1) {
            console.log(`Please provide a version`)
            process.exit(1)
            return
        }
        setVersion(opts[1])
        break
    default:
        console.log(`Unrecognized command line option "${opt}"`)
        process.exit(1)
        return
}
