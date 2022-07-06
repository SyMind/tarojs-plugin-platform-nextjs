import ReactDOM from 'react-dom'
import promisify from 'mpromisify'
import {limited} from '../_util'
import type * as swan from '../swan'

function chooseImageInternal({
    count = 1,
    success,
    complete,
    sourceType = ['album', 'camera']
}: swan.chooseImage.Param): void {
    const result: swan.chooseImage.ParamPropSuccessParam = {
        tempFilePaths: [],
        tempFiles: []
    }

    const el = document.createElement('input')
    el.setAttribute('type', 'file')
    if (count > 1) {
        el.setAttribute('multiple', 'multiple')
    }
    if (Array.isArray(sourceType) && sourceType.length) {
        el.setAttribute('capture', sourceType.join(','))
    }
    el.setAttribute('accept', 'image/*')
    el.setAttribute('style', 'position: fixed; top: -4000px; left: -3000px; z-index: -300;')
    document.body.appendChild(el)

    el.onchange = e => {
        const target = e.target as HTMLInputElement
        const files = target.files ? Array.from(target.files) : []
        for (const file of files) {
            const blob = new Blob([file], {
                type: file.type
            })
            const url = URL.createObjectURL(blob)
            result.tempFilePaths.push(url)
            result.tempFiles?.push({
                path: url,
                size: file.size
            })
        }

        success(result)
        complete?.()
    }

    const event = document.createEvent('MouseEvents')
    event.initEvent('click', true, true)
    el.dispatchEvent(event)
}

/**
 * 从本地相册选择图片或使用相机拍照。
 *
 * @example
 * ```javascript
 * Taro.chooseImage({
 *   count: 1, // 默认9
 *   sizeType: ['original', 'compressed'], // 可以指定是原图还是压缩图，默认二者都有
 *   sourceType: ['album', 'camera'], // 可以指定来源是相册还是相机，默认二者都有
 *   success: function (res) {
 *     // 返回选定照片的本地文件路径列表，tempFilePath可以作为img标签的src属性显示图片
 *     var tempFilePaths = res.tempFilePaths
 *   }
 * })
 * ```
 */
export const chooseImage = promisify(limited.async('chooseImage', chooseImageInternal))

interface PreviewProps {
    /**
     * 当前显示图片的链接，不填则默认为 urls 的第一张
     */
    defaultCurrent?: string

    /**
     * 需要预览的图片链接列表
     */
    urls: string[]

    /**
     * 关闭时触发
     */
    onClose?: () => void;
}

type PreviewType = React.ComponentType<PreviewProps>

let Preview: PreviewType | null = null

/**
 * 内部方法，注册预览组件
 */
export function registerPreviewComponent(Target: PreviewType): void {
    Preview = Target
}

let previewContainer: HTMLDivElement | null = null

function previewImageInternal({
    current,
    urls,
    success,
    fail,
    complete
}: swan.previewImage.Param): void {
    if (!Preview) {
        if (process.env.NODE_ENV === 'development') {
            console.error('`Preview` component is not registered.')
        }
        return
    }

    if (previewContainer) {
        return
    }

    if (!urls) {
        fail?.({
            errMsg: 'The urls param is required.'
        })
        complete?.()
        return
    }

    previewContainer = document.createElement('div')
    document.body.appendChild(previewContainer)
    ReactDOM.render(
        <Preview
            defaultCurrent={current}
            urls={urls}
            onClose={() => {
                ReactDOM.unmountComponentAtNode(previewContainer!)
                previewContainer = null
            }}
        />,
        previewContainer
    )
    success?.({})
}

/**
 * 在新页面中全屏预览图片。预览的过程中用户可以进行保存图片、发送给朋友等操作。
 *
 * @example
 * ```tsx
 * Taro.previewImage({
 *   current: '', // 当前显示图片的http链接
 *   urls: [] // 需要预览的图片http链接列表
 * })
 * ```
 */
export  const previewImage = promisify(limited.async('previewImage', previewImageInternal))
