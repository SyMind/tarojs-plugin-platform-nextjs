const path = require('path')
const {parseJson} = require('./utils')

function resolveAliasToTSConfigPaths(alias, tsconfigPath) {
    const {baseUrl = '.'} = parseJson(tsconfigPath).compilerOptions
    const pathsBaseUrl = path.resolve(path.dirname(tsconfigPath), baseUrl)

    const paths = {}

    Object.keys(alias).forEach(item => {
        const key = item + '/*'
        const value = path.relative(pathsBaseUrl, alias[item])
        paths[key] = [value + '/*']
    })

    return paths
}

module.exports = resolveAliasToTSConfigPaths