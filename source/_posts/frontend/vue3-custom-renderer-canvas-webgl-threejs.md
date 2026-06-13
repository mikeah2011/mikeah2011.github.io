---

title: Vue 3 Custom Renderer 实战：用 Vue 的响应式驱动 Canvas/WebGL/Three.js——游戏化电商与数据可视化的自定义渲染器
keywords: [Vue, Custom Renderer, Canvas, WebGL, Three.js, 的响应式驱动, 游戏化电商与数据可视化的自定义渲染器, 前端]
date: 2026-06-10 03:03:00
categories:
  - frontend
cover: https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
images:
  - https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=1200&h=630&fit=crop
tags:
- Vue
- CustomRenderer
- Canvas
- WebGL
- Three.js
- 游戏化
- 可视化
description: 深入 Vue 3 Custom Renderer API，从零构建 Canvas 2D、WebGL 和 Three.js 自定义渲染器，实战游戏化电商互动页面和高性能数据可视化大屏。
---


## 为什么需要 Custom Renderer？

Vue 3 的核心架构做了一件很聪明的事：把**响应式系统**和**渲染逻辑**彻底分离。`@vue/reactivity` 可以独立使用，而渲染层通过 `createRenderer` 注入。这意味着你可以用 Vue 的响应式 API 驱动任何渲染目标——不只是 DOM。

想象这些场景：

- **游戏化电商**：商品以 3D 场景展示，用户旋转、缩放、点击加入购物车，所有交互状态用 Vue 的 `ref` / `reactive` 管理
- **数据可视化大屏**：Canvas 2D 绘制数千个图表元素，数据变化时自动 diff 并局部重绘
- **跨平台渲染**：同一套 Vue 组件逻辑，既能渲染到浏览器 DOM，也能渲染到 Canvas、WebGL 甚至终端

这些都是 Custom Renderer 的用武之地。

## 核心原理：createRenderer 的接口契约

Vue 3 的 `createRenderer` 接收一个 `NodeOps` 对象，定义了「如何创建节点」「如何插入节点」「如何更新属性」等操作。DOM 版本的实现就是 `@vue/runtime-dom`，而我们要做的就是替换这些操作。

```typescript
import { createRenderer, type RendererOptions } from '@vue/runtime-core'

// NodeOps 定义了渲染器需要实现的所有操作
interface RendererOptions<HostNode, HostElement> {
  createElement(type: string): HostNode
  createText(text: string): HostNode
  setText(node: HostNode, text: string): void
  setElementText(node: HostNode, text: string): void
  insert(child: HostNode, parent: HostNode, anchor?: HostNode | null): void
  remove(child: HostNode): void
  parentNode(node: HostNode): HostNode | null
  nextSibling(node: HostNode): HostNode | null
  patchProp(el: HostNode, key: string, prevValue: any, nextValue: any): void
  // ... 还有一些可选操作
}
```

关键洞察：**type 在 DOM 里是标签名（div、span），但在自定义渲染器里可以是任意字符串**——代表你的渲染世界里的「元素类型」。

## 实战一：Canvas 2D 渲染器

### 设计思路

Canvas 2D 渲染器的思路：把 Vue 组件树映射到一个「虚拟画布对象」树，每次数据变化时重绘画布。

我们定义几种基础元素类型：
- `rect`：矩形
- `circle`：圆形
- `text`：文本
- `group`：容器（类似 DOM 的 div）

```typescript
// canvas-renderer.ts
import { createRenderer } from '@vue/runtime-core'

interface CanvasNode {
  type: string
  props: Record<string, any>
  children: CanvasNode[]
  parent: CanvasNode | null
  // Canvas 特有属性
  x?: number
  y?: number
  width?: number
  height?: number
}

const { createApp, defineComponent, h, ref, reactive, onMounted } = (() => {
  // 先创建渲染器
  const nodeOps = {
    createElement(type: string): CanvasNode {
      return {
        type,
        props: {},
        children: [],
        parent: null,
      }
    },

    createText(text: string): CanvasNode {
      return {
        type: '__text',
        props: { text },
        children: [],
        parent: null,
      }
    },

    setText(node: CanvasNode, text: string): void {
      node.props.text = text
    },

    setElementText(node: CanvasNode, text: string): void {
      node.props.text = text
    },

    insert(child: CanvasNode, parent: CanvasNode, anchor?: CanvasNode | null): void {
      // 从旧父节点移除
      if (child.parent) {
        const idx = child.parent.children.indexOf(child)
        if (idx > -1) child.parent.children.splice(idx, 1)
      }
      child.parent = parent
      if (anchor) {
        const anchorIdx = parent.children.indexOf(anchor)
        parent.children.splice(anchorIdx, 0, child)
      } else {
        parent.children.push(child)
      }
    },

    remove(child: CanvasNode): void {
      if (child.parent) {
        const idx = child.parent.children.indexOf(child)
        if (idx > -1) child.parent.children.splice(idx, 1)
      }
    },

    parentNode(node: CanvasNode): CanvasNode | null {
      return node.parent
    },

    nextSibling(node: CanvasNode): CanvasNode | null {
      if (!node.parent) return null
      const siblings = node.parent.children
      const idx = siblings.indexOf(node)
      return siblings[idx + 1] || null
    },

    patchProp(el: CanvasNode, key: string, prevValue: any, nextValue: any): void {
      el.props[key] = nextValue
    },

    // 以下为 DOM 特有，Canvas 中可空实现
    querySelector: () => null,
    setScopeId: () => {},
    insertStaticContent: () => [],
  }

  const renderer = createRenderer(nodeOps)
  return {
    createApp: renderer.createApp,
    defineComponent,
    h,
    ref,
    reactive,
    onMounted,
  }
})()

export { createApp, defineComponent, h, ref, reactive, onMounted }
export type { CanvasNode }
```

### Canvas 绘制引擎

渲染器只负责维护虚拟节点树，实际绘制需要一个独立的引擎：

```typescript
// canvas-engine.ts
import type { CanvasNode } from './canvas-renderer'

export function createCanvasEngine(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d')!
  let rootNode: CanvasNode | null = null

  function setRoot(node: CanvasNode) {
    rootNode = node
  }

  function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    if (rootNode) drawNode(rootNode, ctx)
  }

  function drawNode(node: CanvasNode, ctx: CanvasRenderingContext2D) {
    const { type, props, children } = node

    ctx.save()

    switch (type) {
      case 'rect':
        ctx.fillStyle = props.fill || '#000'
        ctx.fillRect(props.x || 0, props.y || 0, props.width || 100, props.height || 100)
        if (props.stroke) {
          ctx.strokeStyle = props.stroke
          ctx.lineWidth = props.strokeWidth || 1
          ctx.strokeRect(props.x || 0, props.y || 0, props.width || 100, props.height || 100)
        }
        break

      case 'circle':
        ctx.beginPath()
        ctx.arc(props.x || 0, props.y || 0, props.radius || 50, 0, Math.PI * 2)
        ctx.fillStyle = props.fill || '#000'
        ctx.fill()
        if (props.stroke) {
          ctx.strokeStyle = props.stroke
          ctx.lineWidth = props.strokeWidth || 1
          ctx.stroke()
        }
        break

      case 'text':
        ctx.font = props.font || '16px sans-serif'
        ctx.fillStyle = props.fill || '#000'
        ctx.textAlign = props.textAlign || 'left'
        ctx.textBaseline = props.textBaseline || 'top'
        ctx.fillText(props.text || '', props.x || 0, props.y || 0)
        break

      case 'group':
        // group 本身不绘制，只处理子节点
        if (props.translateX || props.translateY) {
          ctx.translate(props.translateX || 0, props.translateY || 0)
        }
        break
    }

    // 递归绘制子节点
    for (const child of children) {
      drawNode(child, ctx)
    }

    ctx.restore()
  }

  // 动画循环
  let running = false
  function startLoop() {
    if (running) return
    running = true
    function frame() {
      render()
      if (running) requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  }

  function stopLoop() {
    running = false
  }

  return { setRoot, render, startLoop, stopLoop }
}
```

### 实战：游戏化电商商品卡片

下面用这个渲染器做一个互动商品卡片——鼠标悬停时商品「弹起」，点击时加入购物车动画：

```typescript
// ShopCard.vue - 这个组件用的是 Canvas 渲染器，不是 DOM！
import { defineComponent, h, ref, reactive } from './canvas-renderer'

export default defineComponent({
  setup() {
    const product = reactive({
      name: '限量潮鞋',
      price: 1299,
      hoverY: 200,
      scale: 1,
      cartAnim: 0, // 0-1 购物车动画进度
    })

    const inCart = ref(false)

    function onMouseMove(x: number, y: number) {
      // 检测是否在商品区域
      if (x > 50 && x < 250 && y > 150 && y < 350) {
        product.hoverY = 180 // 弹起效果
        product.scale = 1.05
      } else {
        product.hoverY = 200
        product.scale = 1
      }
    }

    function onClick(x: number, y: number) {
      if (x > 50 && x < 250 && y > 150 && y < 350 && !inCart.value) {
        inCart.value = true
        // 触发购物车动画
        animateCart()
      }
    }

    function animateCart() {
      product.cartAnim = 0
      const start = performance.now()
      function frame(now: number) {
        product.cartAnim = Math.min(1, (now - start) / 600)
        if (product.cartAnim < 1) requestAnimationFrame(frame)
      }
      requestAnimationFrame(frame)
    }

    return () => h('group', {}, [
      // 背景卡片
      h('rect', {
        x: 40,
        y: product.hoverY - 10,
        width: 220,
        height: 260,
        fill: '#ffffff',
        stroke: '#e0e0e0',
        strokeWidth: 2,
      }),
      // 商品图（用矩形模拟）
      h('rect', {
        x: 60,
        y: product.hoverY,
        width: 180,
        height: 150,
        fill: '#f5f5f5',
      }),
      // 商品名称
      h('text', {
        x: 60,
        y: product.hoverY + 165,
        text: product.name,
        font: 'bold 18px sans-serif',
        fill: '#333',
      }),
      // 价格
      h('text', {
        x: 60,
        y: product.hoverY + 195,
        text: `¥${product.price}`,
        font: 'bold 20px sans-serif',
        fill: '#ff4444',
      }),
      // 购物车按钮
      h('rect', {
        x: 150,
        y: product.hoverY + 220,
        width: 90,
        height: 32,
        fill: inCart.value ? '#999' : '#ff6600',
      }),
      h('text', {
        x: 165,
        y: product.hoverY + 228,
        text: inCart.value ? '已加入' : '加入购物车',
        font: '14px sans-serif',
        fill: '#fff',
      }),
      // 购物车飞入动画元素
      ...(product.cartAnim > 0 && product.cartAnim < 1 ? [
        h('circle', {
          x: 150 + product.cartAnim * 200,
          y: product.hoverY + 100 - product.cartAnim * 100,
          radius: 10 * (1 - product.cartAnim),
          fill: '#ff6600',
        }),
      ] : []),
    ])
  },
})
```

### 挂载到 Canvas

```typescript
// main.ts
import { createApp } from './canvas-renderer'
import { createCanvasEngine } from './canvas-engine'
import ShopCard from './ShopCard'

const canvas = document.getElementById('shop-canvas') as HTMLCanvasElement
canvas.width = 800
canvas.height = 600

const engine = createCanvasEngine(canvas)
const app = createApp(ShopCard)

// 挂载并获取根节点
const root = app.mount({
  // Canvas 渲染器的 mount target 可以是自定义对象
  __canvas: canvas,
})

// 把根节点交给引擎
engine.setRoot(root)
engine.startLoop()

// 处理鼠标事件
canvas.addEventListener('mousemove', (e) => {
  const rect = canvas.getBoundingClientRect()
  const x = e.clientX - rect.left
  const y = e.clientY - rect.top
  // 触发 Vue 响应式更新
  root.emit('mousemove', x, y)
})

canvas.addEventListener('click', (e) => {
  const rect = canvas.getBoundingClientRect()
  const x = e.clientX - rect.left
  const y = e.clientY - rect.top
  root.emit('click', x, y)
})
```

## 实战二：WebGL 渲染器（精简版）

WebGL 渲染器比 Canvas 2D 复杂得多，因为你需要管理着色器、缓冲区、纹理等 GPU 资源。这里给出核心骨架：

```typescript
// webgl-renderer.ts
import { createRenderer } from '@vue/runtime-core'

interface WebGLNode {
  type: string
  props: Record<string, any>
  children: WebGLNode[]
  parent: WebGLNode | null
  // WebGL 资源
  glBuffers?: WebGLBuffer[]
  glProgram?: WebGLProgram
  dirty: boolean
}

function createWebGLRenderer(gl: WebGLRenderingContext) {
  const programCache = new Map<string, WebGLProgram>()

  function compileShader(source: string, type: number): WebGLShader {
    const shader = gl.createShader(type)!
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(`Shader compile error: ${gl.getShaderInfoLog(shader)}`)
    }
    return shader
  }

  function createProgram(vsSource: string, fsSource: string): WebGLProgram {
    const key = vsSource + fsSource
    if (programCache.has(key)) return programCache.get(key)!

    const program = gl.createProgram()!
    gl.attachShader(program, compileShader(vsSource, gl.VERTEX_SHADER))
    gl.attachShader(program, compileShader(fsSource, gl.FRAGMENT_SHADER))
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`Program link error: ${gl.getProgramInfoLog(program)}`)
    }
    programCache.set(key, program)
    return program
  }

  // 默认着色器
  const defaultVS = `
    attribute vec2 a_position;
    attribute vec4 a_color;
    uniform vec2 u_resolution;
    varying vec4 v_color;
    void main() {
      vec2 clipSpace = (a_position / u_resolution) * 2.0 - 1.0;
      gl_Position = vec4(clipSpace * vec2(1, -1), 0, 1);
      v_color = a_color;
    }
  `
  const defaultFS = `
    precision mediump float;
    varying vec4 v_color;
    void main() {
      gl_FragColor = v_color;
    }
  `

  const nodeOps = {
    createElement(type: string): WebGLNode {
      return {
        type,
        props: {},
        children: [],
        parent: null,
        dirty: true,
      }
    },

    createText(text: string): WebGLNode {
      return {
        type: '__text',
        props: { text },
        children: [],
        parent: null,
        dirty: true,
      }
    },

    setText(node: WebGLNode, text: string): void {
      node.props.text = text
      node.dirty = true
    },

    setElementText(node: WebGLNode, text: string): void {
      node.props.text = text
      node.dirty = true
    },

    insert(child: WebGLNode, parent: WebGLNode, anchor?: WebGLNode | null): void {
      if (child.parent) {
        const idx = child.parent.children.indexOf(child)
        if (idx > -1) child.parent.children.splice(idx, 1)
      }
      child.parent = parent
      if (anchor) {
        const anchorIdx = parent.children.indexOf(anchor)
        parent.children.splice(anchorIdx, 0, child)
      } else {
        parent.children.push(child)
      }
      parent.dirty = true
    },

    remove(child: WebGLNode): void {
      if (child.parent) {
        const idx = child.parent.children.indexOf(child)
        if (idx > -1) child.parent.children.splice(idx, 1)
        child.parent.dirty = true
      }
      // 清理 GPU 资源
      if (child.glBuffers) {
        child.glBuffers.forEach((b) => gl.deleteBuffer(b))
      }
    },

    parentNode(node: WebGLNode): WebGLNode | null {
      return node.parent
    },

    nextSibling(node: WebGLNode): WebGLNode | null {
      if (!node.parent) return null
      const siblings = node.parent.children
      const idx = siblings.indexOf(node)
      return siblings[idx + 1] || null
    },

    patchProp(el: WebGLNode, key: string, prevValue: any, nextValue: any): void {
      el.props[key] = nextValue
      el.dirty = true
    },

    querySelector: () => null,
    setScopeId: () => {},
    insertStaticContent: () => [],
  }

  const renderer = createRenderer(nodeOps)

  // 绘制函数
  function drawNode(node: WebGLNode) {
    if (node.type === 'triangle' && node.props.vertices) {
      const program = createProgram(defaultVS, defaultFS)
      gl.useProgram(program)

      const posBuffer = gl.createBuffer()!
      gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer)
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(node.props.vertices), gl.STATIC_DRAW)

      const posLoc = gl.getAttribLocation(program, 'a_position')
      gl.enableVertexAttribArray(posLoc)
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0)

      const colorLoc = gl.getUniformLocation(program, 'u_color')
      const color = node.props.color || [1, 0, 0, 1]
      gl.uniform4fv(colorLoc, color)

      const resLoc = gl.getUniformLocation(program, 'u_resolution')
      gl.uniform2f(resLoc, gl.canvas.width, gl.canvas.height)

      gl.drawArrays(gl.TRIANGLES, 0, 3)
    }

    for (const child of node.children) {
      drawNode(child)
    }
  }

  return { renderer, drawNode }
}
```

## 实战三：Three.js 渲染器（最实用）

Three.js 渲染器是最实用的场景，因为 Three.js 本身就有场景图，和 Vue 组件树天然契合。

```typescript
// three-renderer.ts
import { createRenderer } from '@vue/runtime-core'
import * as THREE from 'three'

interface ThreeNode {
  type: string
  object3D: THREE.Object3D
  props: Record<string, any>
  children: ThreeNode[]
  parent: ThreeNode | null
}

function createThreeRenderer() {
  function createObject3D(type: string, props: Record<string, any>): THREE.Object3D {
    switch (type) {
      case 'mesh': {
        const geometry = props.geometry || new THREE.BoxGeometry(1, 1, 1)
        const material = props.material || new THREE.MeshStandardMaterial({ color: 0x00ff00 })
        return new THREE.Mesh(geometry, material)
      }
      case 'group':
        return new THREE.Group()
      case 'ambientLight':
        return new THREE.AmbientLight(props.color || 0xffffff, props.intensity || 0.5)
      case 'directionalLight':
        return new THREE.DirectionalLight(props.color || 0xffffff, props.intensity || 1)
      case 'pointLight':
        return new THREE.PointLight(props.color || 0xffffff, props.intensity || 1)
      case 'perspectiveCamera': {
        const cam = new THREE.PerspectiveCamera(
          props.fov || 75,
          props.aspect || 1,
          props.near || 0.1,
          props.far || 1000
        )
        if (props.position) {
          cam.position.set(props.position[0], props.position[1], props.position[2])
        }
        return cam
      }
      default:
        return new THREE.Group()
    }
  }

  const nodeOps = {
    createElement(type: string): ThreeNode {
      const object3D = createObject3D(type, {})
      return { type, object3D, props: {}, children: [], parent: null }
    },

    createText(text: string): ThreeNode {
      // Three.js 没有原生文本节点，可以用 Sprite + Canvas 纹理
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')!
      canvas.width = 256
      canvas.height = 64
      ctx.font = '24px sans-serif'
      ctx.fillStyle = '#ffffff'
      ctx.fillText(text, 0, 32)
      const texture = new THREE.CanvasTexture(canvas)
      const material = new THREE.SpriteMaterial({ map: texture })
      const sprite = new THREE.Sprite(material)
      return { type: '__text', object3D: sprite, props: { text }, children: [], parent: null }
    },

    setText(node: ThreeNode, text: string): void {
      node.props.text = text
      // 更新纹理
      if (node.object3D instanceof THREE.Sprite) {
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')!
        canvas.width = 256
        canvas.height = 64
        ctx.font = '24px sans-serif'
        ctx.fillStyle = '#ffffff'
        ctx.fillText(text, 0, 32)
        const texture = new THREE.CanvasTexture(canvas)
        ;(node.object3D.material as THREE.SpriteMaterial).map = texture
        texture.needsUpdate = true
      }
    },

    setElementText(node: ThreeNode, text: string): void {
      node.props.text = text
    },

    insert(child: ThreeNode, parent: ThreeNode, anchor?: ThreeNode | null): void {
      if (child.parent) {
        const idx = child.parent.children.indexOf(child)
        if (idx > -1) child.parent.children.splice(idx, 1)
        child.parent.object3D.remove(child.object3D)
      }
      child.parent = parent
      if (anchor) {
        const anchorIdx = parent.children.indexOf(anchor)
        parent.children.splice(anchorIdx, 0, child)
        // Three.js 没有 insertBefore，需要重建
        parent.object3D.add(child.object3D)
      } else {
        parent.children.push(child)
        parent.object3D.add(child.object3D)
      }
    },

    remove(child: ThreeNode): void {
      if (child.parent) {
        const idx = child.parent.children.indexOf(child)
        if (idx > -1) child.parent.children.splice(idx, 1)
        child.parent.object3D.remove(child.object3D)
      }
    },

    parentNode(node: ThreeNode): ThreeNode | null {
      return node.parent
    },

    nextSibling(node: ThreeNode): ThreeNode | null {
      if (!node.parent) return null
      const siblings = node.parent.children
      const idx = siblings.indexOf(node)
      return siblings[idx + 1] || null
    },

    patchProp(el: ThreeNode, key: string, prevValue: any, nextValue: any): void {
      el.props[key] = nextValue

      // 处理常见属性
      const obj = el.object3D
      switch (key) {
        case 'position':
          if (Array.isArray(nextValue)) {
            obj.position.set(nextValue[0], nextValue[1], nextValue[2])
          }
          break
        case 'rotation':
          if (Array.isArray(nextValue)) {
            obj.rotation.set(nextValue[0], nextValue[1], nextValue[2])
          }
          break
        case 'scale':
          if (Array.isArray(nextValue)) {
            obj.scale.set(nextValue[0], nextValue[1], nextValue[2])
          } else if (typeof nextValue === 'number') {
            obj.scale.set(nextValue, nextValue, nextValue)
          }
          break
        case 'visible':
          obj.visible = !!nextValue
          break
        case 'color':
          if ('color' in (el.object3D as any)) {
            ;(el.object3D as any).color.set(nextValue)
          }
          break
        case 'intensity':
          if ('intensity' in (el.object3D as any)) {
            ;(el.object3D as any).intensity = nextValue
          }
          break
      }
    },

    querySelector: () => null,
    setScopeId: () => {},
    insertStaticContent: () => [],
  }

  return createRenderer(nodeOps)
}
```

### Three.js 渲染器实战：3D 商品展示

```typescript
// Product3D.vue（概念示例，使用 Three.js 渲染器）
import { defineComponent, h, ref, onMounted } from './three-renderer'
import * as THREE from 'three'

export default defineComponent({
  setup() {
    const rotationY = ref(0)
    const hovered = ref(false)

    // 动画循环
    let frameId: number
    function animate() {
      rotationY.value += 0.01
      frameId = requestAnimationFrame(animate)
    }

    onMounted(() => {
      animate()
    })

    return () => h('group', {}, [
      // 相机
      h('perspectiveCamera', {
        fov: 50,
        aspect: window.innerWidth / window.innerHeight,
        position: [0, 1.5, 4],
      }),
      // 环境光
      h('ambientLight', { color: 0xffffff, intensity: 0.6 }),
      // 主光源
      h('directionalLight', {
        color: 0xffffff,
        intensity: 0.8,
        position: [5, 5, 5],
      }),
      // 商品模型（用立方体模拟）
      h('mesh', {
        geometry: new THREE.BoxGeometry(1, 1.2, 1),
        material: new THREE.MeshStandardMaterial({
          color: hovered.value ? 0xff6600 : 0x3366ff,
          roughness: 0.3,
          metalness: 0.7,
        }),
        position: [0, 0.6, 0],
        rotation: [0, rotationY.value, 0],
        scale: hovered.value ? 1.1 : 1,
      }),
      // 底座
      h('mesh', {
        geometry: new THREE.CylinderGeometry(1.5, 1.5, 0.1, 32),
        material: new THREE.MeshStandardMaterial({ color: 0x333333 }),
        position: [0, 0, 0],
      }),
    ])
  },
})
```

## 性能优化策略

### 1. 批量更新

Canvas 渲染器不应该每个响应式变化都重绘，用 `requestAnimationFrame` 合并：

```typescript
let needsRender = false

function scheduleRender() {
  if (!needsRender) {
    needsRender = true
    requestAnimationFrame(() => {
      render()
      needsRender = false
    })
  }
}

// 在 patchProp 中调用 scheduleRender 而不是直接 render
patchProp(el, key, prevValue, nextValue) {
  el.props[key] = nextValue
  scheduleRender()
}
```

### 2. 脏标记优化

只重绘变化的子树：

```typescript
function drawNode(node: CanvasNode, ctx: CanvasRenderingContext2D) {
  if (!node.dirty && !hasDirtyChild(node)) return
  // ... 绘制逻辑
  node.dirty = false
}
```

### 3. 离屏 Canvas

对于静态元素，先绘制到离屏 Canvas，然后 `drawImage` 贴过来：

```typescript
const offscreen = document.createElement('canvas')
// 把不常变化的元素画到 offscreen
// 主循环中直接 drawImage(offscreen, ...)
```

## 踩坑记录

### 坑 1：insert 的 anchor 参数

Vue 内部的 diff 算法会用 anchor 来精确控制插入位置。如果你的 `insert` 实现忽略了 anchor，`v-if` 和 `v-for` 的切换顺序会出错。

```typescript
// ❌ 错误：忽略 anchor
insert(child, parent) {
  parent.children.push(child)
}

// ✅ 正确：处理 anchor
insert(child, parent, anchor) {
  if (anchor) {
    const idx = parent.children.indexOf(anchor)
    parent.children.splice(idx, 0, child)
  } else {
    parent.children.push(child)
  }
}
```

### 坑 2：parentNode 必须准确

`parentNode` 返回 null 会导致 Vue 认为节点已经脱离 DOM 树，触发不必要的卸载。确保每个节点的 parent 都正确维护。

### 坑 3：patchProp 的 key 格式

Vue 会把 `v-bind:foo-bar` 转成 `fooBar`（camelCase），而 DOM 事件会用 `onFooBar` 格式。你的 patchProp 需要处理这些转换。

### 坑 4：ref 引用

在自定义渲染器中，`ref` 获取到的是你的自定义节点（如 CanvasNode），不是 DOM 元素。确保你处理的类型正确。

### 坑 5：Three.js 的 dispose

Three.js 的几何体、材质、纹理不会自动释放。在 `remove` 操作中要手动 `dispose()`，否则内存泄漏：

```typescript
remove(child: ThreeNode): void {
  // 清理 GPU 资源
  child.object3D.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry.dispose()
      if (Array.isArray(obj.material)) {
        obj.material.forEach((m) => m.dispose())
      } else {
        obj.material.dispose()
      }
    }
  })
  // 从父节点移除
  if (child.parent) {
    child.parent.object3D.remove(child.object3D)
  }
}
```

## 与 Laravel 后端集成

在实际项目中，3D 场景的配置数据通常来自后端 API。Laravel 提供数据，Vue 组件消费：

```php
// Laravel Controller
class ProductSceneController extends Controller
{
    public function show(Product $product): JsonResponse
    {
        return response()->json([
            'scene' => [
                'camera' => ['position' => [0, 1.5, 4]],
                'lights' => [
                    ['type' => 'ambient', 'color' => '#ffffff', 'intensity' => 0.6],
                    ['type' => 'directional', 'position' => [5, 5, 5]],
                ],
                'models' => $product->scene_configs,
            ],
            'product' => [
                'name' => $product->name,
                'price' => $product->price,
                'model_url' => $product->glb_url,
            ],
        ]);
    }
}
```

前端拿到配置后，动态生成 Vue 组件树：

```typescript
async function loadScene(productId: number) {
  const { scene, product } = await fetch(`/api/products/${productId}/scene`).then(r => r.json())

  // 动态构建组件树
  const children = [
    h('perspectiveCamera', scene.camera),
    ...scene.lights.map((l: any) => h(`${l.type}Light`, l)),
    h('mesh', {
      geometry: await loadGLB(product.model_url),
      position: [0, 0.6, 0],
    }),
  ]

  // 渲染
  const app = createApp(defineComponent({
    render: () => h('group', {}, children)
  }))
}
```

## 总结

Vue 3 的 Custom Renderer 是一个被低估的 API。它让你用声明式的方式管理任何渲染目标的状态，核心价值在于：

1. **响应式驱动**：不用手动管理脏标记和重绘调度，Vue 帮你做了
2. **组件化**：复杂的 Canvas/WebGL 场景可以拆分成组件，逻辑复用
3. **生态兼容**：VueUse、Pinia 等库可以直接用在自定义渲染器中

适用场景：游戏化交互页面、数据可视化大屏、3D 商品展示、跨平台渲染引擎。

不适用场景：简单的 Canvas 绘画（原生 API 更直接）、对性能极度敏感的游戏（需要绕过 Vue 的抽象层）。

核心代码仓库结构：

```
src/
├── canvas-renderer.ts    # Canvas 2D 渲染器
├── canvas-engine.ts      # 绘制引擎 + 动画循环
├── webgl-renderer.ts     # WebGL 渲染器
├── three-renderer.ts     # Three.js 渲染器
├── components/
│   ├── ShopCard.tsx      # 游戏化商品卡片
│   ├── DataChart.tsx     # 数据可视化图表
│   └── Product3D.tsx     # 3D 商品展示
└── main.ts
```

下一步可以探索的方向：把 Custom Renderer 和 Server Components 结合，实现 3D 场景的服务端预渲染；或者用 Web Worker 跑响应式计算，主线程只负责渲染。
