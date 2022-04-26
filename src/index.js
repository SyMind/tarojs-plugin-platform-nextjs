const path = require('path')
const fs = require('fs')
const {src, dest, watch} = require('gulp')
const rename = require('gulp-rename')
const filter = require('gulp-filter')
const es = require('event-stream')
const {merge} = require('lodash')
const ejs = require('ejs')
const chalk = require('chalk')
const spawn = require('cross-spawn')
const open = require('open')
const getNextjsExportedFunctions = require('./getNextjsExportedFunctions')
const resolveAliasToTSConfigPaths = require('./resolveAliasToTSConfigPaths')
const resolveDynamicPagesToRewrites = require('./resolveDynamicPagesToRewrites')
const {ensureLeadingSlash, resolveScriptPath, parseJson, isDynamicRoute, unIndent} = require('./utils')

const isWindows = process.platform === 'win32';

const DEFAULT_ROUTER_CONFIG = {
    mode: 'browser',
    customRoutes: {}
}

const DEFAULT_POSTCSS_OPTIONS = ['autoprefixer', 'pxtransform', 'cssModules']

const DEFAULT_AUTOPREFIXER_OPTION = {
    enable: true,
    config: {
        flexbox: 'no-2009'
    }
}

const DEFAULT_PORT = '10086'

module.exports = ctx => {
    const {paths, helper, runOpts} = ctx
    const {appPath, outputPath, sourcePath} = paths

    ctx.registerCommand({
        name: 'start',
        optionsMap: {
            '-p, --port': 'A port number on which to start the application'
        },
        synopsisList: [
            'taro start -p <port>'
        ],
        async fn () {
            const port = runOpts.port || runOpts.p || DEFAULT_PORT
            spawn('next', ['start', outputPath, '-p', port], {
                stdio: 'inherit'
            })
        }
    })

    ctx.registerPlatform({
        name: 'nextjs',
        useConfigName: 'h5',
        async fn({config}) {
            const {
                sourceRoot = 'src',
                outputRoot = 'dist',
                router = DEFAULT_ROUTER_CONFIG,
                env,
                defineConstants,
                mode,
                alias = {},
                sass = {},
                designWidth = 750,
                postcss = {},
                isWatch,
                devServer = {}
            } = config

            if (router.mode !== 'browser') {
                throw new Error('Next.js only support `browser` router mode.')
            }

            const appConfigFilePath = resolveScriptPath(path.join(sourcePath, `${helper.ENTRY}.config`))
            const appConfig = helper.readConfig(appConfigFilePath)
            const appFilePath = resolveScriptPath(path.join(sourcePath, helper.ENTRY))

            const outputsourcePath = path.join(outputPath, sourceRoot)
            const outputAppFilePath = path.join(outputsourcePath, helper.ENTRY) + path.extname(appFilePath)
            const nextAppFilePath = path.join(outputPath, 'pages/_app.tsx')

            const templateDir = path.resolve(__dirname, '../template')

            const taroPages = []
            if (Array.isArray(appConfig.pages)) {
                for (const page of appConfig.pages) {
                    taroPages.push(ensureLeadingSlash(page))
                }
            }
            if (Array.isArray(appConfig.subPackages)) {
                for (const package of appConfig.subPackages) {
                    if (!Array.isArray(package.pages)) {
                        return
                    }

                    for (const page of package.pages) {
                        taroPages.push(ensureLeadingSlash(`${package.root}/${page}`))
                    }
                }
            }

            const customRoutes = Object.create(null)
            if (router.customRoutes) {
                for (const key of Object.keys(router.customRoutes)) {
                    customRoutes[ensureLeadingSlash(key)] = router.customRoutes[key]
                }
            }

            function createNextjsPages() {
                const result = []

                const nextjsPagesDir = `${outputPath}/pages`

                for (const taroPage of taroPages) {
                    const taroPageFilePath = resolveScriptPath(path.join(sourcePath, taroPage))
                    const taroPageDir = path.dirname(taroPageFilePath)
                    const taroRoute = customRoutes[taroPage] || taroPage

                    const files = fs.readdirSync(taroPageDir)
                    const dynamicPageFileName = files.find(name => isDynamicRoute(name))
                    let dynamicPageFileBaseName
                    if (dynamicPageFileName) {
                        const dynamicPageFileExt = path.extname(dynamicPageFileName)
                        dynamicPageFileBaseName = path.basename(dynamicPageFileName, dynamicPageFileExt)
                        result.push(`${taroRoute}/${dynamicPageFileBaseName}`)
                    }

                    const targetPageFile = dynamicPageFileName || 'index.js'
                    const targetPageFilePath = dynamicPageFileName
                        ? path.join(taroPageDir, dynamicPageFileName)
                        : taroPageFilePath
                    const nextjsPageFilePath = path.join(nextjsPagesDir, taroRoute, targetPageFile)

                    const nextjsPageDir = path.dirname(nextjsPageFilePath)
                    if (!fs.existsSync(nextjsPageDir)) {
                        fs.mkdirSync(nextjsPageDir, {recursive: true})
                    }

                    const exportedFunctions = getNextjsExportedFunctions(targetPageFilePath)

                    let request = `${outputPath}/${sourceRoot}${taroPage}`
                    if (dynamicPageFileBaseName) {
                        request = path.join(path.dirname(request), dynamicPageFileBaseName)
                    }
                    const modulePath = path.relative(nextjsPageDir, request)

                    let contents = unIndent`
                        import {TaroPageWrapper} from 'tarojs-plugin-platform-nextjs/taro'
                        import TaroPage from '${modulePath}'

                        export default function NextPage(props) {
                            return <TaroPageWrapper TaroPage={TaroPage} {...props} />
                        }
                    `
                    if (exportedFunctions.length) {
                        contents += `\nexport {${exportedFunctions.join(', ')}} from '${modulePath}'`
                    }
                    fs.writeFileSync(nextjsPageFilePath, contents, {encoding: 'utf-8'})
                }

                const customRoutesFilePath = path.join(outputPath, 'customRoutes.json')
                fs.writeFileSync(customRoutesFilePath, JSON.stringify(customRoutes, null, '  '), {encoding: 'utf-8'})

                return result
            }

            const dynamicPages = createNextjsPages()

            function scaffold() {
                return es.merge(
                    src(`${appPath}/*.d.ts`).pipe(dest(outputPath)),
                    src(`${sourcePath}/**`)
                        .pipe(filter(file => {
                            const stat = fs.statSync(file.path)
                            if (stat.isDirectory()) {
                                return true
                            }

                            const ext = path.extname(file.path)
                            if (!helper.SCRIPT_EXT.includes(ext)) {
                                return true
                            }

                            const dir = path.dirname(file.path)
                            const name = path.basename(file.path, ext)
                            const specifiedFilePath = path.join(dir, `${name}.h5${ext}`)
                            return !fs.existsSync(specifiedFilePath)
                        }))
                        .pipe(rename(p => {
                            const secondaryExt = path.extname(p.basename)
                            if (secondaryExt === '.h5') {
                                p.basename = path.basename(p.basename, secondaryExt)
                            }
                        }))
                        .pipe(dest(outputsourcePath)),
                    src(`${templateDir}/pages/**`).pipe(dest(path.join(outputPath, 'pages'))),
                    src(`${templateDir}/next.config.ejs`)
                        .pipe(es.through(function (data) {
                            const additionalData = sass.data
                            const rewrites = resolveDynamicPagesToRewrites(dynamicPages)

                            const ejsData = {
                                env,
                                defineConstants,
                                additionalData,
                                rewrites
                            }
                            const result = ejs.render(data.contents.toString(), ejsData)
                            data.contents = Buffer.from(result)

                            this.emit('data', data)
                        }))
                        .pipe(rename('next.config.js'))
                        .pipe(dest(outputPath)),
                    src(`${templateDir}/postcss.config.ejs`)
                        .pipe(es.through(function (data) {
                            const plugins = Object.entries(postcss).reduce((result, [pluginName, pluginOption]) => {
                                if (
                                    !DEFAULT_POSTCSS_OPTIONS.includes(pluginName) &&
                                    pluginOption?.enable
                                ) {
                                    const isRelative = pluginName.startsWith('./') ||
                                        pluginName.startsWith('../') ||
                                        ((isWindows && pluginName.startsWith('.\\')) ||
                                        pluginName.startsWith('..\\'))

                                    let request = pluginName
                                    if (isRelative) {
                                        const absolutePath = path.join(appPath, pluginName)
                                        request = path.relative(outputPath, absolutePath)
                                    }

                                    const plugin = {
                                        request,
                                        option: pluginOption
                                    }
                                    result.push(plugin)
                                }

                                return result
                            }, [])

                            const autoprefixerOption = merge({}, DEFAULT_AUTOPREFIXER_OPTION, postcss.autoprefixer)
                            const ejsData = {
                                designWidth,
                                autoprefixerOption: autoprefixerOption.enable
                                    ? JSON.stringify(autoprefixerOption.config)
                                    : null,
                                plugins
                            }
                            const result = ejs.render(data.contents.toString(), ejsData)
                            data.contents = Buffer.from(result)

                            this.emit('data', data)
                        }))
                        .pipe(rename('postcss.config.js'))
                        .pipe(dest(outputPath)),
                    src(`${templateDir}/babel.config.ejs`)
                        .pipe(es.through(function (data) {
                            const ejsData = {
                                nextAppFilePath: JSON.stringify(path.relative(outputPath, nextAppFilePath)),
                                outputAppFilePath: JSON.stringify(path.relative(outputPath, outputAppFilePath))
                            }
                            const result = ejs.render(data.contents.toString(), ejsData)
                            data.contents = Buffer.from(result)

                            this.emit('data', data)
                        }))
                        .pipe(rename('babel.config.js'))
                        .pipe(dest(outputPath)),
                    src(`${templateDir}/tsconfig.json`)
                        .pipe(es.through(function (data) {
                            const taroTSConfigPath = path.join(appPath, 'tsconfig.json')
                            if (fs.existsSync(taroTSConfigPath)) {
                                const taroTSConfig = parseJson(taroTSConfigPath)
                                const templateTSConfig = parseJson(data.path)

                                let mergedTSConfig = templateTSConfig
                                const paths = resolveAliasToTSConfigPaths(alias, taroTSConfigPath)
                                mergedTSConfig = merge(taroTSConfig, templateTSConfig, {compilerOptions: {paths}})

                                data.contents = Buffer.from(JSON.stringify(mergedTSConfig, null, '  '))
                            }
                            this.emit('data', data)
                        }))
                        .pipe(dest(outputPath))
                )
            }
            scaffold().on('end', async () => {
                const port = devServer.port || DEFAULT_PORT
                const args = []
                if (mode === 'development') {
                    args.push('dev')
                    args.push('-p', port)
                } else {
                    args.push('build')
                }

                // Jest 测试时暂不执行以下逻辑
                if (process.env.NODE_ENV === 'test') {
                    return
                }

                spawn('next', args, {
                    cwd: outputPath,
                    stdio: 'inherit'
                })

                if (isWatch) {
                    const indexRoute = customRoutes[taroPages[0]] || taroPages[0]
                    if (indexRoute) {
                        open(`http://127.0.0.1:${port}${indexRoute}`)
                    }

                    function hasSpecifiedFile(filePath) {
                        const dir = path.dirname(filePath)
                        const ext = path.extname(filePath)
                        const base = path.basename(filePath, ext)

                        if (!fs.existsSync(dir)) {
                            return false
                        }

                        const files = fs.readdirSync(dir)
                        return files.some(name => {
                            const ext = path.extname(name)
                            if (!helper.SCRIPT_EXT.includes(ext)) {
                                return false
                            }
                            const primaryBase = path.basename(name, ext)
                            const secondaryExt = path.extname(primaryBase)
                            if (secondaryExt !== '.h5') {
                                return false
                            }
                            const secondaryBase = path.basename(primaryBase, secondaryExt)
                            return secondaryBase === base
                        })
                    }

                    function getOutputFilePath(filePath) {
                        const relativePath = filePath.substring(appPath.length + 1)

                        const ext = path.extname(filePath)
                        if (!helper.SCRIPT_EXT.includes(ext)) {
                            return path.join(outputPath, relativePath)
                        }

                        const base = path.basename(relativePath, ext)
                        const secondaryExt = path.extname(base)
                        if (secondaryExt === '.h5') {
                            return path.join(
                                outputPath,
                                path.dirname(relativePath),
                                path.basename(base, secondaryExt) + ext
                            )
                        }

                        if (hasSpecifiedFile(filePath)) {
                            return null
                        }

                        return path.join(outputPath, relativePath)
                    }

                    function handleWatch(operation, filePath) {
                        const outputFilePath = getOutputFilePath(filePath)
                        if (!outputFilePath) {
                            return
                        }

                        const relativePath = filePath.substring(appPath.length + 1)
                        console.log(`${chalk.green(`File was ${operation}`)} ${relativePath}`)

                        if (['changed', 'added'].includes(operation)) {
                            const outputDir = path.dirname(outputFilePath)
                            if (!fs.existsSync(outputDir)) {
                                fs.mkdirSync(outputDir, {recursive: true})
                            }
                            fs.copyFileSync(filePath, outputFilePath)
                        }

                        if (operation === 'removed') {
                            fs.rmSync(outputFilePath)
                        }
                    }

                    const watcher = watch(`${sourcePath}/**`, {readDelay: 200})
                    watcher.on('change', filePath => handleWatch('changed', filePath))
                    watcher.on('add', filePath => handleWatch('added', filePath))
                    watcher.on('unlink', filePath => handleWatch('removed', filePath))
                }
            })
        }
    })
}
