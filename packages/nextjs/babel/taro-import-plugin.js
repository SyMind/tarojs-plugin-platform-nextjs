module.exports = function (babel) {
    const t = babel.types

    return {
        name: 'taro-import-plugin',
        visitor: {
            ImportDeclaration(path) {
                const source = path.get('source')
                if (source.isStringLiteral()) {
                    if (source.node.value === '@tarojs/components') {
                        source.replaceWith(
                            t.stringLiteral('@taror/components')
                        )
                    } else if (source.node.value === '@tarojs/taro') {
                        source.replaceWith(
                            t.stringLiteral('tarojs-plugin-platform-nextjs/taro')
                        )
                    }
                }
            }
        }
    }
}
