/**
 * LocalPaint Guide: short how-to guides plus an offline "smart" search that understands
 * everyday wording ("how do i make my brush go smoothly like guiding a path"),
 * synonyms and typos.
 */
import { VERSION } from './version';

/** A "Show me" button: the app runs `act` (switch tool, open a panel…) and then highlights `hl`. */
export interface GuideShow { label: string; act?: string; hl?: string; text?: string }
export interface GuideBlock { h?: string; p?: string; steps?: string[]; tips?: string[]; table?: [string, string][] }
export interface Guide {
  id: string;
  title: string;
  cat: string;
  /** One line under the title (also shown in search results). */
  sum: string;
  /** Concepts this guide answers (see SYN), plus any extra keywords. */
  tags: string[];
  words?: string;
  body: GuideBlock[];
  show?: GuideShow[];
  related?: string[];
}

export const CATS = ['Start here', 'Basics', 'Painting', 'Layers & materials', 'Baking', 'Material Designer', 'Export', 'Help & settings'];

export const GUIDES: Guide[] = [
  // ------------------------------------------------------------------ start here
  {
    id: 'getting-started', title: 'Getting started', cat: 'Start here',
    sum: 'What LocalPaint is, how it works and how to set it up.',
    tags: ['start', 'basics', 'tutorial', 'new', 'setup', 'substance'],
    words: 'begin beginner first time intro introduction learn welcome overview how works familiar controls',
    body: [
      { p: 'This is a personal and free alternative to paid material painting programs like **Substance Painter**. The controls are kept familiar, so if you have used Substance before most things work the same way here.' },
      { h: 'How it works', p: 'You open a 3D model and paint materials on it. A material is more than a colour. It also has roughness, metal, height and glow, and the brush paints all of them at once. Your work is made of layers. A paint layer is for painting by hand. A fill layer covers the model with one material, and a mask decides where it shows. Smart materials (rust, worn paint and so on) look at the shape of the model to put wear on the edges and dirt in the gaps. That is why you bake the mesh maps first. When you are done you export the textures for Roblox, Unreal, Unity or Blender.' },
      { h: 'Setting up', steps: [
        'Open a model. Pick one on the start screen or use File > Open model (FBX, OBJ or GLB). The model has to be UV unwrapped.',
        'Bake the mesh maps. Click Baking at the top right, then Bake selected textures.',
        'Paint. Drag a smart material from the Assets shelf onto the model, or press B and paint on a paint layer.',
        'Save and export. Ctrl+S saves an .lp project and Ctrl+Shift+E exports the textures.',
      ] },
      { h: 'Controls', table: [
        ['Orbit / pan / zoom', 'Right mouse (or Alt + left) / middle mouse / wheel'],
        ['Paint, eraser, picker', 'B, E, P'],
        ['Smudge, clone, blur', 'U, C, R   (clone source: hold V + click)'],
        ['Brush size', '[ ]   (or Ctrl + scroll)'],
        ['Brush hardness', '{ }   (or Ctrl + right drag)'],
        ['Stroke opacity', 'Ctrl + Shift + scroll'],
        ['Flow, rotation', 'Ctrl + left drag'],
        ['Straight line', 'Shift + click'],
        ['Paint the layer mask', 'M'],
        ['Polygon fill, path', 'G, L'],
        ['Frame the model', 'F'],
        ['3D / 2D / both', 'F2 / F3 / F4'],
        ['Undo, redo, history', 'Ctrl+Z, Ctrl+Y, H'],
        ['Save, open, export', 'Ctrl+S, Ctrl+O, Ctrl+Shift+E'],
        ['This guide', 'F1'],
      ] },
      { tips: ['You can type a question in the search box at the top, for example "how do I make rust" or "it lags".'] },
    ],
    show: [{ label: 'Assets shelf', hl: '#shelf' }, { label: 'Layers panel', hl: '#right' }],
    related: ['open-model', 'baking', 'smart-materials', 'export'],
  },
  {
    id: 'whats-new', title: `What's new in v${VERSION}`, cat: 'Start here',
    sum: 'What LocalPaint can do in this version.',
    tags: ['new', 'update', 'version', 'changelog'], words: 'changes release notes added features latest',
    body: [
      { h: 'New in v1.25', steps: [
        'Baking runs on the graphics card now, like Substance: ambient occlusion, curvature and thickness rays are traced on the GPU, many times faster than before, with the same result.',
        'Models with several texture sets build their ray data once for all of them instead of once per set.',
        'If a bake ever comes out wrong on your card, untick "Bake on the graphics card" under Common parameters to use the old CPU baker.',
        'The bake Output size now sets every texture set at once.',
      ] },
      { h: 'New in v1.24', steps: [
        'Texture sets: a model with several materials gets one texture set per material, like in Substance. Each has its own layers, textures, UV view and baked maps.',
        'Click a set in the Texture Set List (top right) to paint it, or double-click a part of the model to jump to its set. The eye hides a set on the model.',
        'Bake bakes every texture set in turn. Export textures writes one set of files per texture set (name_Material_BaseColor.png…), and Export mesh gives each material its own textures.',
        'Projects save every texture set.',
      ] },
      { h: 'New in v1.23', steps: [
        'Importing an FBX (or GLB) now ignores the textures it points to and reads which material each part of the mesh uses, so no more missing-texture errors.',
        'Models with several materials: the ID map gives each material its own colour (parts that share a material share the colour, on every mesh), and dropping an asset or using the polygon fill targets the material of the part you point at.',
        'The polygon fill and Drop onto have a new Material mode for this. Pick another mode any time.',
      ] },
      { h: 'New in v1.22', steps: [
        'The layer right-click menu is laid out like Substance Painter\'s: masks (white, black, bitmap, colour selection, smart masks), toggle / invert / clear mask, flatten, export mask or channels, cut / copy / paste, colour tags, copy / paste mask, blending options and the Add effect items.',
        'Content effects: Add filter, generator, levels or fill to a layer. They show as rows under it, each with its own blend mode and opacity, and turn on and off with the eye.',
        'Filters: blur, sharpen, invert, HSL, contrast / luminosity, clamp, grayscale, posterize, colour tint and gradient map.',
        'Ctrl+C / Ctrl+X / Ctrl+V copy, cut and paste layers. Ctrl+Alt+C / Ctrl+Alt+V copy and paste a mask. Ctrl+M flattens a layer or folder into one paint layer.',
        'Saving a brush, material or smart material asks for its name in LocalPaint\'s own window (the old box didn\'t open in the desktop app).',
      ] },
      { h: 'New in v1.21', steps: [
        'Autosaves no longer show up in the taskbar\'s right-click Recent list or in Recent on the start screen. Only projects you saved or opened yourself go there, each once, newest 10.',
        'Restoring an autosave doesn\'t add it to Recent either. Save it to put it back in the list under its real name.',
      ] },
      { h: 'New in v1.20', steps: [
        'Projected pictures now get a real 3D manipulator in the viewport, like Substance\'s: arrows to move, rings to rotate, cubes to stretch on one axis. W / E / R switch between them.',
        'Drag on the model to stick the projection to the surface, hold Shift to snap, and switch between Local and World axes or Reset from the top bar.',
      ] },
      { h: 'New in v1.19', steps: [
        'Drop a picture onto the model and it\'s projected right there, like Substance\'s planar projection, with handles to move, turn and resize it on the model.',
        'Transparent PNGs keep their transparency: only the picture shows, on every channel of the layer.',
        'Fill layers have a new Planar projection mode, with size, width / height, turn, hide-on-back-faces and repeat settings.',
      ] },
      { h: 'New in v1.18', steps: [
        'New tools: Smudge (U) drags wet paint along, Clone (C) copies one area onto another (hold V + click to set the source), Blur (R) softens what\'s painted.',
        'Brushes: 85+ presets in groups like Substance Painter\'s (Artistic, Dirt & dust, Leaks & stains, Damage, Rust & paint, Nature, Hard surface, FX…), with 18 new tips: watercolour, charcoal, crayon, oil bristles, fingerprints, coffee stains, dust specks, dirt, smoke, leak drips, scuffs, ink splats, rust flakes, fine spray, grass, moss, sand and wet edges.',
        'Brush settings: flow jitter, colour variation per stroke (hue, saturation, value) and backface culling (don\'t paint sides facing away from you).',
      ] },
      { h: 'New in v1.17', steps: ['Layer opacity works like Substance: hold the mouse on the number and drag left or right to change it (Shift for fine steps). Click it to type a value instead. The mouse wheel no longer changes it by accident.'] },
      { h: 'New in v1.16', steps: [
        'Bake by mesh name like Substance Painter: Match: By mesh name with _low / _high suffixes, plus "Only same mesh name" for AO, curvature and thickness, so parts next to each other stop baking onto each other.',
        'More baking settings: AO ignore backface (never / always / by mesh name) and ground plane offset; Position mode (all axes or one axis) and normalization; thickness min distance, spread, distribution and self occlusion; ignore backface for high poly; Restore defaults buttons.',
        'Colours update live while you pick them, with LocalPaint\'s own colour picker (the Windows colour dialog only updated after OK). Editing a value only redraws the channel that changed.',
        '"Bake mesh maps after importing" now starts off and remembers what you choose.',
      ] },
      { h: 'New in v1.15', steps: ['The baker remembers which maps you ticked, for new projects and the next time you open LocalPaint.'] },
      { h: 'New in v1.14', steps: ['Layers stack properly over glowing materials: a smart material or brush stroke on top now covers the glow (emission) of the layers below, like Substance Painter. To make a brush glow, pick an Emission color in Properties.'] },
      { h: 'New in v1.13', steps: ['Reset lighting button in Display settings: puts the light rotation, height and exposure back to the start.'] },
      { h: 'New in v1.12', steps: ['Opal smart material in Basic: a milky body with flecks of green, orange, purple and red fire.', 'Move the light: hold Shift and right-drag in the 3D view, or use Rotation and Light height in Display settings.', 'Assets > Alphas: 150+ stamps, including bolts, nuts, screws, rivets, panels, seams, vents, grilles, gears, hinges, tread plate, arrows, signs, shapes and lines.', 'Baking AO, curvature and thickness is faster (about a quarter on its own, more on PCs with many cores) and gives exactly the same result.', 'Smart materials with parts LocalPaint can\'t read import the rest instead of failing. New guide page: Help: errors.'] },
      { h: 'New in v1.11', steps: ['The Basic smart materials (Dusty Plastic, Rusty Iron, Worn Gold and the rest) now show their previews straight away, along with the newer Painter-style smart materials and smart masks.'] },
      { h: 'New in v1.10', steps: ['New brush controls: hold Ctrl and scroll to change brush size, Ctrl + Shift + scroll for stroke opacity, Ctrl + right-drag for hardness. Ctrl + left-drag still sets flow and rotation.'] },
      { h: 'New in v1.09', steps: ['Fixed freezes when dropping smart materials and smart material previews that never showed up: the new mask generators compiled very slowly on Windows. They now compile in under a second, on the loading screen.'] },
      { h: 'New in v1.08', steps: ['Less lag after dropping a smart material, and shelf previews are made only while you pause.'] },
      { h: 'New in v1.07', steps: ['Loading after an update is quick again: new smart material previews are made in the background.'] },
      { h: 'New in v1.06', steps: [
        'Every smart material uses the Painter-style generators now, so edges, dirt, dust and rust look like Painter\'s.',
        '52 new scanned smart materials: painted metal, rusty sheet metal, clean metals, worn woods, weathered stone, brick, fabric and plastic.',
        '117 Painter-style smart materials (Steel Painted, Copper Worn, Leather Sofa, Plastic Glossy Scuffed, Wood Walnut…) rebuilt from the layers and mask settings of Painter\'s own, using free scans and grunges.',
        'About 300 free scanned materials (was 114), with new Asphalt, Roofing, Terrazzo and Ice & glass groups.',
        '15 more smart masks (55 in all), and every smart mask runs on the Painter generators, with an Amount slider that grows or shrinks the whole mask.',
      ] },
      { h: 'New in v1.05', steps: [
        'Masks work like Substance Painter\'s now: Dirt, Metal Edge Wear, Dust, Mask Editor, Mask Builder, Light, Position, AO and Curvature generators with Painter\'s settings and maths.',
        'Smart masks rebuilt from Painter\'s recipes (Dirt Cavities, Dust Occlusion, Edges Uber, Rust and more), using free CC0 grunge scans.',
        'Painter smart masks (.spmsk) can be opened, and masks in .spsm smart materials come in with their whole stack.',
        'A New project window like Painter\'s: template, resolution, normal format, baked maps, and an option to bake right after importing.',
        'File > Export mesh: GLB with your textures inside, or OBJ.',
        'Projects are now .lp files. Old .lmp files still open.',
        'The Guide shows a few "Did you know?" tips under the search bar. They change every hour.',
      ] },
      { h: 'New in v1.04', steps: ['Smaller downloads: build tools and temporary build output are excluded from release packages.'] },
      { h: 'New in v1.03', steps: ['Fixed download links, consistent handling of unsupported .spp files, and clearer messages for damaged projects.'] },
      { h: 'New in v1.02', steps: ['Bug fixes: opening a Substance Painter project (.spp) or another file that isn\'t a LocalPaint project now says what it is and what to do, instead of a confusing error.'] },
      { h: 'New in v1.01', steps: ['LMP is now called LocalPaint (LP for short), with a new logo. Your .lmp projects, settings and presets carry over.', 'Bug fixes.'] },
      { h: 'In v1.00', steps: [
        'Paint colour, roughness, metal, height and glow in one stroke, with brushes, layers, folders and masks.',
        'Smart materials and smart masks (edge wear, dirt, rust) that follow the shape of your model, with anchor points for micro details.',
        'Shapes you can place and move on the model, or tile over the UVs.',
        '114 free scanned materials, and Substance .sbsar materials with all their settings (exact with Adobe\'s engine if Substance 3D Designer is installed).',
        'Bake normal, AO, curvature, thickness and other mesh maps, including from a high poly.',
        'Hold ~ for Blender-style camera views (front, top, left…).',
        'Autosave, history, UV overlap check, and this Guide with walk-throughs.',
        'LocalPaint checks for updates and can install them for you.',
      ] },
    ],
    related: ['autosave', 'history', 'lazy-mouse', 'pen-pressure'],
  },
  {
    id: 'about', title: 'About LocalPaint', cat: 'Start here',
    sum: `Version ${VERSION} and who made it.`,
    tags: ['about', 'credits'], words: 'owner author made creator who license version leodevrx leo dev github copyright',
    body: [
      { p: `LocalPaint, version ${VERSION}.` },
      { p: 'This program is owned by **[LeoDevRX](https://github.com/LeoDevRX/LMP/commits?author=LeoDevRX)**.' },
      { p: 'Made with three.js and Electron.' },
      { p: 'LocalPaint isn\'t made by, affiliated with or endorsed by Adobe. Substance, Substance 3D Painter and Substance 3D Designer are trademarks of Adobe; they\'re named only to say which files LocalPaint can open. LocalPaint doesn\'t include any Adobe software or Substance materials.' },
      { p: 'Scanned materials come from ambientCG and the HDR environments from Poly Haven, both CC0. Open-source licenses are in the licenses folder next to LocalPaint.exe.' },
    ],
  },

  // ------------------------------------------------------------------ basics
  {
    id: 'navigate', title: 'Moving around the model', cat: 'Basics',
    sum: 'Orbit, pan, zoom, camera views and layouts.',
    tags: ['camera', 'view', 'layout'], words: 'rotate orbit turn spin pan move zoom scroll frame center focus look around front back top side 2d 3d split',
    body: [
      { steps: [
        'Hold the right mouse button and drag to orbit (Alt + left drag also works).',
        'Hold the middle mouse button and drag to pan.',
        'Scroll to zoom.',
        'Press F to fit the model in view. With the mouse over the 2D view it fits the texture instead.',
        'Number keys 1 to 9 and 0 switch to front, back, side and top views.',
        'F2 shows only 3D, F3 only 2D, F4 both.',
      ] },
    ],
    show: [{ label: 'Layout buttons', hl: '#toolbar .tb-right' }],
  },
  {
    id: 'open-model', title: 'New file / opening a model', cat: 'Basics',
    sum: 'Open an FBX, OBJ or GLB model, or start with a built in shape.',
    tags: ['new', 'open', 'model', 'import'], words: 'fbx obj glb gltf mesh load file start blender roblox character uv material materials texture missing textures id map multiple materials texture set texture sets texture set list udim',
    body: [
      { steps: [
        'Pick a model on the start screen, use File > Open model, or drag the model file into the 3D view.',
        'The New project window opens. Pick the project template (it sets the starting layers and the export template) and the document resolution.',
        'Leave "Bake mesh maps after importing" on and LocalPaint bakes AO, curvature and the other mesh maps as soon as the model is in.',
        'Under Advanced settings you can pick the normal map format (OpenGL or DirectX) and bring in mesh maps you already baked somewhere else.',
        'The model needs UVs. Unwrap it in Blender or similar first.',
        'Textures the file points to are ignored: LocalPaint keeps the meshes, the UVs and which material each part uses.',
      ] },
      { h: 'Models with several materials (texture sets)', steps: [
        'Every material becomes its own texture set, like in Substance: its own layers, its own textures and its own UV space, so UVs of different materials may overlap.',
        'The Texture Set List (top right) shows them all. Click one to paint it; the Layers panel and the 2D view switch to that set. Double-click a part of the model to jump to its set.',
        'Only the selected set gets painted. The others stay visible on the model, and the eye next to a set hides it.',
        'Bake bakes every set. Ambient occlusion still counts the other sets\' parts, so a handle shadows the barrel next to it.',
        'Export textures writes each set\'s maps with its name in the file name, and Export mesh gives each material its own textures.',
        'Give your materials names in Blender. Materials with the same name count as one set.',
      ] },
      { tips: ['File > Export mesh saves the model back out as GLB (with your textures inside) or OBJ.'] },
    ],
    show: [{ label: 'Open the start window', act: 'open' }],
    related: ['baking', 'save-open'],
  },
  {
    id: 'save-open', title: 'Saving and opening projects', cat: 'Basics',
    sum: 'Ctrl+S saves everything into one .lp file.',
    tags: ['save', 'open', 'file'], words: 'project lp lmp save as keep store recent reopen load double click',
    body: [
      { steps: [
        'Ctrl+S saves. The first time it asks where to put the file. Ctrl+Shift+S is Save as.',
        'The file gets the model and texture set name and ends in .lp. It holds the model, layers and masks.',
        'Ctrl+O opens a window with your recent projects and autosaves, plus a Browse button.',
        'You can also double click an .lp file in Windows to open it.',
      ] },
      { tips: ['If you close LocalPaint with unsaved changes it asks if you want to save first.', 'Projects from before v1.05 end in .lmp. They still open, and get saved as .lp.'] },
    ],
    show: [{ label: 'Recent projects', act: 'open' }],
    related: ['autosave'],
  },
  {
    id: 'autosave', title: 'Autosave and getting lost work back', cat: 'Basics',
    sum: 'LocalPaint keeps backups while you work.',
    tags: ['autosave', 'recover', 'crash', 'save'], words: 'backup lost work closed crashed freeze restore auto saved rescue',
    body: [
      { steps: [
        'Every few minutes LocalPaint saves a backup if something changed. You\'ll see "Autosaved" at the bottom for a moment.',
        'If LocalPaint closed without you quitting it, it offers to restore the latest backup when you start it again.',
        'You can open any backup yourself with Ctrl+O > Autosaves.',
        'How often it saves and how many backups it keeps can be changed in File > Settings.',
      ] },
      { tips: ['Backups go in D:\\LocalPaint\\autosave if you have a D: drive, otherwise next to LocalPaint.', 'Opening a backup opens a copy, so your original file stays as it was until you save.'] },
    ],
    show: [{ label: 'Autosaves', act: 'autosaves' }, { label: 'Settings', act: 'settings' }],
    related: ['history', 'settings'],
  },
  {
    id: 'history', title: 'Undo and the History panel', cat: 'Basics',
    sum: 'Ctrl+Z and Ctrl+Y, or press H to see your recent changes.',
    tags: ['undo', 'history'], words: 'mistake oops back revert previous earlier before redo step accidentally go back return restore latest ctrl z',
    body: [
      { steps: [
        'Ctrl+Z undoes and Ctrl+Y redoes.',
        'Press H (or the clock button on the left) to open History. It lists your last 25 changes with the newest at the top.',
        'Click a row to go back to that point. The changes after it turn grey but they\'re still there.',
        'If you pressed Ctrl+Z too many times, click the top row to get back to where you were.',
        '"Original" at the bottom is the file before any of these changes.',
      ] },
      { tips: ['If you go back and then make a new change, the grey rows are dropped.', 'You can change the number of steps in File > Settings.'] },
    ],
    show: [{ label: 'History', act: 'history', hl: '#shelf' }],
    related: ['autosave'],
  },

  // ------------------------------------------------------------------ painting
  {
    id: 'paint-basics', title: 'Painting on the model', cat: 'Painting',
    sum: 'Brush size, flow, opacity, hardness and what the brush paints.',
    tags: ['paint', 'brush'], words: 'draw color colour size bigger smaller hardness soft hard channels roughness metal height first stroke',
    body: [
      { steps: [
        'Select a paint layer in the Layers panel, or click Add paint layer.',
        'Press B and paint with the left mouse button.',
        'Change size with [ and ], hardness with { and }, or hold Ctrl and right drag on the model.',
        'Properties > Material sets what the brush paints (colour, roughness, metal, height, glow). You can turn each one on or off.',
      ] },
      { tips: ['Dragging a material from the shelf onto the Properties panel loads it into the brush.'] },
    ],
    show: [{ label: 'Brush', act: 'tool:paint', hl: '#toolbar' }, { label: 'Brush settings', act: 'props', hl: '#right' }],
    related: ['flow-opacity', 'brush-tips', 'eraser'],
  },
  {
    id: 'flow-opacity', title: 'Flow and stroke opacity', cat: 'Painting',
    sum: 'What the difference is.',
    tags: ['flow', 'opacity', 'brush'], words: 'transparent transparency see through faint light build up strength alpha',
    body: [
      { p: 'Flow is how much paint each dab of the brush adds. With low flow the paint builds up slowly as you go over the same spot.' },
      { p: 'Stroke opacity is the most one stroke can cover. At 50, a single stroke never goes past half, no matter how much you go over it.' },
      { tips: ['Ctrl + left drag sideways changes flow while you paint.', 'With a drawing tablet you can let pen pressure control flow.'] },
    ],
    show: [{ label: 'Sliders', act: 'tool:paint', hl: '#toolbar .tb-scroll' }],
    related: ['pen-pressure'],
  },
  {
    id: 'lazy-mouse', title: 'Smoother strokes (lazy mouse)', cat: 'Painting',
    sum: 'The brush follows the cursor on a string, so lines come out less shaky.',
    tags: ['smoothing', 'brush', 'line', 'stroke'],
    words: 'smooth smoothly steady stable stabilizer stabiliser shaky wobbly jitter jittery lazy mouse string guide guiding follow trail clean neat calm hand shake',
    body: [
      { steps: [
        'Press B for the brush.',
        'Turn up Smoothing in the toolbar (it\'s also in Properties > Brush). Around 20 to 40 works well.',
        'When you paint, a dotted line shows between the cursor and the brush. The brush only moves once the line is pulled tight, so small wobbles don\'t show.',
        'Set it back to off when you don\'t need it.',
      ] },
      { tips: ['To paint along an exact curve, use the Path tool (L).', 'Shift + click draws a straight line.'] },
    ],
    show: [{ label: 'Smoothing', act: 'tool:paint', hl: '#toolbar .inline-slider', text: 'Smoothing' }],
    related: ['path-tool', 'straight-lines'],
  },
  {
    id: 'path-tool', title: 'Painting along a path', cat: 'Painting',
    sum: 'Click points to make a curve and the brush follows it.',
    tags: ['path', 'line', 'smoothing', 'stroke'],
    words: 'bezier curve curved follow guide guiding along path spline seam stitch trace outline route line tool handles',
    body: [
      { steps: [
        'Press L or click the path button on the left.',
        'Click on the model to add points. Click and drag to pull out handles and bend the curve.',
        'The brush paints along the curve while you edit, so you can see what you\'ll get. Drag points or handles to change it.',
        'Press Enter or double click to finish. Esc cancels and Delete removes the selected point.',
      ] },
      { tips: ['Useful for stitches, seams, cables and stripes. Turn on "Follow stroke" in the brush tip settings so the tip turns with the curve.', 'It works in the 2D view too.'] },
    ],
    show: [{ label: 'Path tool', act: 'tool:path', hl: '#toolstrip button[title^="Path"]' }],
    related: ['lazy-mouse', 'straight-lines', 'brush-tips'],
  },
  {
    id: 'straight-lines', title: 'Straight lines', cat: 'Painting',
    sum: 'Shift + click draws a line from where your last stroke ended.',
    tags: ['line', 'stroke'], words: 'straight shift click ruler connect join dots edge',
    body: [
      { steps: ['Paint a dot or a stroke.', 'Hold Shift and click somewhere else. A straight line joins the two.', 'Keep Shift clicking to carry on the line.'] },
      { tips: ['For curved lines use the Path tool (L).'] },
    ],
    show: [{ label: 'Brush', act: 'tool:paint' }],
    related: ['path-tool', 'lazy-mouse'],
  },
  {
    id: 'symmetry', title: 'Mirror painting', cat: 'Painting',
    sum: 'Paint both sides at once. A red line shows where it mirrors.',
    tags: ['symmetry'], words: 'mirror both sides symmetric symmetrical x y z axis flip reflect copy left right red line plane',
    body: [
      { steps: [
        'Turn on X, Y or Z next to "Sym" in the toolbar. The X key turns X on and off.',
        'A red line on the model shows where the mirror is.',
        'To move it, use the X, Y or Z position slider in Properties > Brush. "Centre the mirror planes" puts it back.',
      ] },
    ],
    show: [{ label: 'Symmetry', act: 'tool:paint', hl: '#toolbar .sym-wrap' }],
  },
  {
    id: 'pen-pressure', title: 'Drawing tablets and pen pressure', cat: 'Painting',
    sum: 'Press harder to make the brush bigger or stronger.',
    tags: ['pressure', 'brush'], words: 'pen tablet wacom huion xp-pen stylus pressure sensitivity draw hard soft surface ipad',
    body: [
      { steps: [
        'Plug in your tablet. LocalPaint picks up the pressure by itself.',
        'In Properties > Brush, turn on Size and/or Flow next to Pen pressure.',
        'Press lightly for thin, light strokes and harder for big, strong ones.',
      ] },
      { tips: ['A mouse always paints at full pressure.'] },
    ],
    show: [{ label: 'Pen pressure', act: 'props', hl: '#right .row', text: 'Pen pressure' }],
    related: ['flow-opacity'],
  },
  {
    id: 'picker', title: 'Eyedropper (picker)', cat: 'Painting',
    sum: 'P picks up the material or colour from the model.',
    tags: ['picker', 'color'], words: 'eyedropper eye dropper drop pick sample copy colour color grab match same',
    body: [
      { steps: [
        'Press P or click the picker on the left.',
        'In the toolbar choose Material (everything) or Color only.',
        'Click on the model or the 2D view. A small swatch next to the cursor shows what you\'re about to pick.',
        'After picking, LocalPaint switches back to the tool you were using.',
      ] },
    ],
    show: [{ label: 'Picker', act: 'tool:picker', hl: '#toolbar' }],
  },
  {
    id: 'eraser', title: 'Eraser', cat: 'Painting',
    sum: 'E switches to the eraser.',
    tags: ['erase'], words: 'eraser rubber remove delete clear undo paint wipe',
    body: [
      { steps: ['Press E. Press it again to go back to the brush.', 'Paint over what you want to remove.', 'On a mask the eraser paints black, which hides the layer there.'] },
    ],
    show: [{ label: 'Eraser', act: 'tool:erase' }],
    related: ['masks', 'smudge-clone-blur'],
  },
  {
    id: 'smudge-clone-blur', title: 'Smudge, clone and blur', cat: 'Painting',
    sum: 'Push wet paint around, copy one area onto another, or soften what\'s already painted.',
    tags: ['brush'], words: 'smudge smear finger drag push wet mix blend clone copy stamp duplicate source repeat blur soften soft fuzzy sharp edges tools u c r v',
    body: [
      { h: 'Smudge (U)', steps: [
        'Press U, or click the finger on the left toolbar.',
        'Drag across paint that\'s already on the layer: it gets picked up and smeared along, like a finger in wet paint.',
        'Flow sets the strength. High flow makes long smears, low flow short soft ones.',
      ] },
      { h: 'Clone (C)', steps: [
        'Press C, or click the stamp on the toolbar.',
        'Hold V and click where you want to copy from.',
        'Paint somewhere else. The copy follows your brush at the same distance from the source. Hold V and click again to pick a new source.',
      ] },
      { h: 'Blur (R)', steps: [
        'Press R, or click the drop on the toolbar.',
        'Paint over hard edges or noisy spots to soften them. A bigger brush blurs more; flow sets the strength.',
      ] },
      { tips: ['All three work on the channels ticked under Properties > Material, on paint layers and on masks (press M first).', 'Any brush preset or tip works with them: pick a grungy tip to smudge in a rough way.', 'Ctrl+Z undoes them like any stroke.'] },
    ],
    show: [{ label: 'Smudge', act: 'tool:smudge' }],
    related: ['eraser', 'brushes', 'masks'],
  },
  {
    id: 'brush-tips', title: 'Brush tips and alphas', cat: 'Painting',
    sum: 'Change the brush shape and add some randomness.',
    tags: ['brush', 'alpha', 'tip'], words: 'shape stamp alpha alphas texture grunge splatter scratch dots rotation rotate angle jitter random scatter follow stroke spacing custom image bolt bolts screw screws rivet rivets vent vents grille panel seam hard surface hardsurface detail details gear hinge arrow sign',
    body: [
      { steps: [
        'With the brush selected, go to Properties > Brush tip.',
        'Pick a tip, or click Import tip to use your own black and white image.',
        'Rotation, Follow stroke, angle jitter, size jitter and scatter make it look less repetitive.',
        'Spacing (in Properties > Brush) is the gap between each dab.',
      ] },
      { h: 'More randomness', steps: [
        'Flow jitter changes how strong each dab is.',
        'Colour variation (hue, saturation, value) gives every stroke a slightly different colour around the brush colour: great for hand-painted looks, rust, moss and leaves.',
        'Backface culling (in Properties > Brush) stops a big brush wrapping onto sides that face away from you. 90° is like Substance; slide it to the end to turn it off.',
      ] },
      { h: 'Alphas on the shelf', p: 'Assets > Alphas has 150+ stamps: bolts, nuts, screws, rivets, panels and seams, vents and grilles, gears, hinges, tread plate, arrows and signs, shapes, lines and stencil letters. Click one to use it as the brush tip; your size and other settings stay the same. For hard-surface detail, paint with only Height turned on and click once per stamp (or raise Spacing).' },
    ],
    show: [{ label: 'Brush tips', act: 'props', hl: '#right' }],
    related: ['brushes'],
  },
  {
    id: 'brushes', title: 'Brush presets', cat: 'Painting',
    sum: 'Ready made brushes on the shelf, and saving your own.',
    tags: ['brush'], words: 'gubby bunny funny preset presets brushes dirt chalk spray leaks rust tape hair fur fibers wood grain smudge pencil airbrush save brush watercolour watercolor charcoal crayon oil paint marker hand painted fingerprint fingerprints stain stains coffee water ink splatter scuff scuffs dust sand grime moss lichen grass weld rivet bolt seam smoke glow artistic categories',
    body: [
      { steps: [
        'Open Brushes on the Assets shelf on the left.',
        'Click one to load its tip and settings.',
        'If you set up a brush you like, click Save brush in Properties to keep it.',
      ] },
      { h: 'What\'s there', p: '85+ brushes in groups like Substance Painter\'s: Basic, Artistic (watercolour, charcoal, crayon, oil paint, marker, hand-painted), Dirt & dust (dirt, dust specks, sand, fingerprints, grime), Leaks & stains (drips, coffee and water stains, ink splatter), Damage (scratches, scuffs, chips, cracks), Rust & paint (rust flakes, spray paint, paint drips), Nature (grass, moss, lichen, leaves), Fabric, skin & hair, Hard surface (rivets, bolts, seams, weld beads, panel lines) and FX (smoke, glow dots). Your own brushes go under Custom.' },
    ],
    show: [{ label: 'Brushes', act: 'shelf:brush', hl: '.shelf-sec', text: 'Brushes' }],
    related: ['brush-tips'],
  },
  {
    id: 'quick-adjust', title: 'Resizing the brush quickly', cat: 'Painting',
    sum: 'Hold Ctrl and drag on the model.',
    tags: ['brush', 'size'], words: 'resize bigger smaller ctrl drag hardness rotation quick adjust radius',
    body: [
      { table: [['Size', 'Ctrl + scroll'], ['Hardness', 'Ctrl + right drag (right or up = harder)'], ['Stroke opacity', 'Ctrl + Shift + scroll'], ['Flow', 'Ctrl + left drag left/right'], ['Rotation', 'Ctrl + left drag up/down'], ['Size in steps', '[  ]'], ['Hardness in steps', '{  }']] },
    ],
  },
  {
    id: 'paint-2d', title: 'Painting in the 2D view', cat: 'Painting',
    sum: 'Paint straight onto the flat texture.',
    tags: ['uv', 'layout'], words: '2d flat texture uv view wireframe islands unwrap',
    body: [
      { steps: ['Press F4 for 3D and 2D side by side, or F3 for only 2D.', 'Paint in the 2D view the same way. Scroll zooms and the middle mouse pans.', 'W shows the UV wireframe.'] },
    ],
    show: [{ label: '3D + 2D', act: 'layout:split' }],
  },
  {
    id: 'uv-overlap', title: 'Overlapping UVs (dark spots)', cat: 'Painting',
    sum: 'Find the places where UV pieces sit on top of each other.',
    tags: ['uv', 'model'], words: 'overlap overlapping overlaps uv uvs stacked dark black spots spot error problem paints twice both places mirrored seams blender unwrap fix wrong bad',
    body: [
      { p: 'If two parts of the model use the same spot on the texture, painting one also paints the other, and baking can look wrong there. LocalPaint checks this when you open a model.' },
      { steps: [
        'Press O (or the overlap button next to the wireframe button at the top right).',
        'Overlapping parts show as dark spots on the model and in the 2D view. The more pieces stack up, the darker it gets.',
        'Fix those faces in Blender (move or re-unwrap them so they don\'t share space), export the model again and reopen it.',
      ] },
      { tips: ['Mirrored halves that share one UV piece also show up. That is fine if you want both sides to look the same.'] },
    ],
    show: [{ label: 'UV overlaps', act: 'overlap' }],
    related: ['paint-2d', 'open-model'],
  },
  {
    id: 'shapes', title: 'Shapes (move a shape on the model)', cat: 'Layers & materials',
    sum: 'A mask generator that puts a circle, star, heart and more on the model.',
    tags: ['shape', 'mask', 'smart'], words: 'shape shapes circle square star heart triangle hexagon ring diamond cross plus sticker decal logo spot move drag place position generator projection stencil',
    body: [
      { steps: [
        'Right click a layer and choose Add generator > Shape (circle, star…). The layer now only shows inside the shape.',
        'Use the handles on the model: drag the middle to move it (it turns to face the surface), the ring knob to turn it, the square to resize it. Press Esc or Done when it\'s in place.',
        'In Properties pick one of 21 shapes (disc, square, star, capsule, brick, soft ones like bell, paraboloid and gaussian, waves…), and set stretch and how hard the edge is. Tick Invert to cut the shape out instead.',
        'Projection "UV (tiling)" repeats the shape over the whole model in a grid, like Substance\'s Shape fill.',
        'Height detail > Press in / Stick out turns the shape into a dent or bump and makes it an anchor point, so wear and dirt can follow it.',
      ] },
      { tips: ['You can add a shape to an existing mask too: Properties > Mask effects > Add effect > Generator: Shape. Multiply cuts it out of the mask, Lighten adds it.'] },
    ],
    related: ['masks', 'smart-masks'],
  },
  {
    id: 'anchors', title: 'Anchor points (wear around painted details)', cat: 'Layers & materials',
    sum: 'Make edge wear and dirt follow details you painted or shapes you added, not just the model\'s edges.',
    tags: ['anchor', 'mask', 'smart', 'wear', 'shape'], words: 'anchor anchors point points micro details microdetails height detail bolts panels seams engraving react follow around rim edge wear dirt generator reference substance',
    body: [
      { p: 'Generators like Edge wear and Dirt look at the model\'s shape. An anchor point lets them also see details you added with height, like a pressed-in circle, painted panel lines or bolts.' },
      { steps: [
        'Make a detail with height: a fill layer with a Shape mask, then Height detail > Press in (or Stick out). That also makes it an anchor point. Or right click any layer with painted height > Add anchor point.',
        'Pick the layer that should wear (paint, rust, dirt) and give it a generator mask: Edge wear, Dirt, Ambient occlusion or Curvature.',
        'In the mask\'s Properties, set Micro details to your anchor (⚓). The wear now wraps around your detail too.',
        'Use Detail strength to make the effect stronger or weaker.',
      ] },
      { tips: ['Anchors are found by layer name, so rename carefully.', 'Change the detail later (move the shape, paint more height) and the wear follows by itself.'] },
    ],
    related: ['shapes', 'smart-masks'],
  },
  {
    id: 'poly-fill', title: 'Filling a whole part', cat: 'Painting',
    sum: 'G fills a triangle, UV island, part or the whole object.',
    tags: ['fill', 'mask'], words: 'polygon fill bucket island part object triangle face select whole area paint bucket',
    body: [
      { steps: [
        'Press G.',
        'In the toolbar choose Triangle, UV island, Mesh part or Object.',
        'Click on the model, or drag a box. Hold Ctrl to remove instead.',
        'If a mask is selected it fills the mask. This is an easy way to put a material on just one part.',
      ] },
    ],
    show: [{ label: 'Polygon fill', act: 'tool:fill', hl: '#toolbar' }],
    related: ['masks'],
  },

  // ------------------------------------------------------------------ layers & materials
  {
    id: 'layers', title: 'Layers and folders', cat: 'Layers & materials',
    sum: 'Paint layers, fill layers, folders, blend modes and opacity.',
    tags: ['layer'], words: 'layers folder group stack order blend mode opacity hide show duplicate delete rename reorder paint layer fill layer',
    body: [
      { steps: [
        'Add paint layer is for painting by hand. Add fill layer covers the model with one material.',
        'Drag layers up and down to change the order. The top one is drawn on top.',
        'Each layer has its own blend mode and opacity.',
        'Ctrl or Shift click to select several. Ctrl+G puts them in a folder, Ctrl+D duplicates and Delete removes them.',
        'Ctrl+C, Ctrl+X and Ctrl+V copy, cut and paste layers, also between projects.',
      ] },
      { h: 'The right-click menu', steps: [
        'Masks: add a white, black or bitmap mask (from a picture), a colour-selection mask or a smart mask.',
        'Toggle mask turns it off for a moment. Invert mask flips it. Invert mask background swaps what unpainted areas do. Clear mask starts it over.',
        'Create smart mask saves the mask\'s generators to the shelf. Create smart material saves the selected layers or folder.',
        'Flatten layer (Ctrl+M) bakes a layer with its effects, mask and opacity, or a whole folder, into one paint layer that looks the same.',
        'Export mask to file or clipboard, or export the layer\'s channels as PNGs.',
        'Colour tags put a coloured stripe on the layer so you can find it in a long stack.',
        'Copy mask / Paste into mask (Ctrl+Alt+C / Ctrl+Alt+V) moves a mask to other layers.',
        'Blending options sets the blend mode of every selected layer at once.',
      ] },
      { tips: ['The small picture on each layer shows what is painted on it.', 'A mask with a red line through it is turned off.'] },
    ],
    show: [{ label: 'Layers panel', hl: '#right' }],
    related: ['layer-effects', 'masks', 'materials'],
  },
  {
    id: 'layer-effects', title: 'Effects on a layer (filters, generators, levels, fill)', cat: 'Layers & materials',
    sum: 'Stack filters and generators on a layer\'s content, each with its own blend mode and opacity.',
    tags: ['layer', 'effect'], words: 'effect effects fx filter filters blur sharpen invert hsl hue saturation contrast luminosity clamp grayscale posterize tint gradient map levels generator dirt edge wear fill add filter add generator add levels stack',
    body: [
      { steps: [
        'Right-click a layer and pick Add filter, Add generator, Add levels or Add fill, or use the fx button at the top of the Layers panel.',
        'The effect shows as a row under the layer. Click it to change its settings in Properties.',
        'Each effect has an eye to turn it off, a blend mode, an opacity and an × to remove it.',
        'The channel buttons at the top of its settings (color, height, rough, metal, nrm, emiss) choose which channels it changes.',
        'Effects run from the bottom row up, before the layer\'s mask and opacity.',
      ] },
      { h: 'What each one does', steps: [
        'Filter: blur, sharpen, invert, HSL, contrast / luminosity, clamp, grayscale, posterize, colour tint or gradient map.',
        'Generator: Dirt, Metal edge wear, Light, Position, Curvature and the rest give a grey result. Set the blend to Multiply to darken with it, or Screen to lighten.',
        'Levels: remaps dark and light values (input / output black and white, gamma).',
        'Fill: lays a flat colour or value over the content.',
      ] },
      { tips: ['With the mask selected, Add generator puts the generator on the mask instead.', 'Flatten layer (Ctrl+M) bakes the effects into a paint layer if you want to paint over the result.'] },
    ],
    show: [{ label: 'Layers panel', hl: '#right' }],
    related: ['layers', 'masks', 'smart-masks'],
  },
  {
    id: 'masks', title: 'Masks', cat: 'Layers & materials',
    sum: 'A mask shows the layer where it is white and hides it where it is black.',
    tags: ['mask', 'layer'], words: 'mask black white hide reveal only some parts where paint mask selective area',
    body: [
      { steps: [
        'Right click a layer and choose Add black mask. The layer disappears.',
        'Press M (or click the mask thumbnail) and paint white where you want the layer to show.',
        'The eraser paints black. G fills whole parts of the mask.',
        'Press M again to go back to painting the layer itself.',
      ] },
    ],
    show: [{ label: 'Mask button', hl: '#toolstrip' }],
    related: ['smart-masks', 'poly-fill'],
  },
  {
    id: 'smart-masks', title: 'Smart masks', cat: 'Layers & materials',
    sum: 'Masks that follow the shape of the model, like edge wear or dirt.',
    tags: ['mask', 'smart', 'wear'], words: 'smart mask generator edge wear scratched edges dirt cavity ambient occlusion dust grunge curvature thickness gradient procedural automatic',
    body: [
      { steps: [
        'Bake the mesh maps first (Baking at the top right).',
        'Drag a smart mask from the shelf onto a layer, or choose one for the layer\'s mask in Properties.',
        'Move the sliders until it looks right.',
      ] },
      { h: 'Painter generators', p: 'Pick Painter generator as the mask type to get Dirt, Metal Edge Wear, Dust, Mask Editor, Mask Builder, Light, Position, Ambient Occlusion and Curvature with the same settings Substance Painter uses. Settings are grouped the same way (Texture, Ambient Occlusion, Curvature, World Space Normal…).' },
      { tips: [
        'Dirt Cavities, Dust Occlusion, Edges Uber, Rust, Surface Worn and the other smart masks at the top of the list are rebuilt from Painter\'s own settings.',
        'Drop a Painter smart mask (.spmsk) onto LocalPaint and it comes in with its settings. It\'s added to Smart masks too.',
        'Grunges are free CC0 scans that download the first time a mask uses one. Until then a pattern stands in for it.',
      ] },
    ],
    show: [{ label: 'Smart masks', act: 'shelf:mask', hl: '.shelf-sec', text: 'Smart masks' }],
    related: ['baking', 'smart-materials'],
  },
  {
    id: 'smart-materials', title: 'Smart materials', cat: 'Layers & materials',
    sum: 'Ready made materials like rust or worn paint that you drag onto the model.',
    tags: ['smart', 'material', 'wear'], words: 'smart material rust rusty worn old dirty scratched metal painted leather wood plastic aged weathered realistic drag drop',
    body: [
      { steps: [
        'Bake the mesh maps first so the wear ends up on the edges and the dirt in the gaps.',
        'Open Smart materials on the Assets shelf.',
        'Drag one onto the model, onto one part of it, or into the Layers panel.',
        'It comes in as a folder of layers you can change.',
        'To make your own, select your layers and click Save as smart material.',
      ] },
      { tips: ['The previews on the shelf are made with the real layers, so they show what you\'ll actually get.'] },
    ],
    show: [{ label: 'Smart materials', act: 'shelf:smart', hl: '.shelf-sec', text: 'Smart materials' }],
    related: ['baking', 'drop-on-mesh'],
  },
  {
    id: 'materials', title: 'Materials and fill layers', cat: 'Layers & materials',
    sum: 'Cover a layer with a material and change how it tiles.',
    tags: ['material', 'fill'], words: 'material fill layer tile tiling scale triplanar projection uv rotate offset hue saturation pbr metal wood stone fabric',
    body: [
      { steps: [
        'Drag a material from Materials onto the model or the Layers panel. It becomes a fill layer.',
        'In Properties you can change the scale and rotation, switch to Tri-planar to hide seams, and adjust the colour.',
        'Add a mask if you only want it in some places.',
      ] },
    ],
    show: [{ label: 'Materials', act: 'shelf:material', hl: '.shelf-sec', text: 'Materials' }],
    related: ['masks', 'import-images'],
  },
  {
    id: 'import-images', title: 'Using your own images', cat: 'Layers & materials',
    sum: 'Drop in PNG or JPG files and say what each one is.',
    tags: ['import', 'image', 'material'], words: 'image png jpg jpeg photo picture texture drag drop import basecolor albedo diffuse normal map height roughness metallic decal sticker logo',
    body: [
      { steps: [
        'Drag image files into LocalPaint, or press Ctrl+I.',
        'For each image choose Color, Normal, Height, Roughness, Metallic and so on. LocalPaint guesses from the file name.',
        'Then choose where it goes: a new fill layer, the selected fill layer, a brush tip, or just the shelf.',
      ] },
    ],
    show: [{ label: 'Import', act: 'import' }],
    related: ['project-image', 'materials'],
  },
  {
    id: 'project-image', title: 'Projecting an image onto the model (planar projection)', cat: 'Layers & materials',
    sum: 'Drop a picture on the model and place it like a sticker, moving, rotating and stretching it right in the 3D view.',
    tags: ['image', 'import'], words: 'manipulator transform arrows rings axis local world snap w e r project projection planar decal sticker logo label image picture photo png transparent transparency alpha background drag drop place move rotate turn resize scale gizmo handles box projector stencil',
    body: [
      { steps: [
        'Drag one picture (PNG, JPG…) from your computer straight onto the model in the 3D view.',
        'It lands where you dropped it, facing you, on a new fill layer, with a box and a manipulator on it.',
        'Press Esc (or Done) when it\'s where you want it. To change it later, select the layer and click "Edit in the viewport" under Projection in Properties.',
      ] },
      { h: 'The manipulator', steps: [
        'Move (W): drag an arrow to slide along that axis, or a coloured square to slide on that plane.',
        'Rotate (E): drag a ring to turn around that axis. The blue ring spins the picture in place; red and green tilt it.',
        'Scale (R): drag a cube to stretch along one axis (red = width, green = height), or the middle to scale it all.',
        'Drag on the model itself (not on a handle) to stick the projection to the surface under the cursor, facing out from it.',
        'Hold Shift while dragging to move, turn (15°) and scale in steps.',
        'Local / World in the top bar choose whether the axes follow the projection or the scene. Reset puts it back facing you in the middle of the view.',
      ] },
      { h: 'Transparent pictures', p: 'PNGs with a transparent background stay transparent: only the picture shows, on every channel of the layer. Untick "Use the image\'s transparency" in Properties to use the whole rectangle.' },
      { h: 'Settings (Properties > Projection)', steps: [
        'Mode: UV (the model\'s UVs), Tri-planar, or Planar (projected like a sticker).',
        'Size, Width / height and Turn change the box too, if you want exact numbers. Scale repeats the image inside it.',
        'Hide on back faces stops the picture showing through on the back of the model.',
        'Repeat outside the box tiles the image beyond the box.',
        'Turn on other channels (roughness, height, metal…) to make the sticker change those too, cut out by the picture.',
      ] },
      { tips: ['Dropping a set of maps (_BaseColor, _Normal…) or several pictures still opens the import window.', 'Like any fill layer, you can add a mask to the projected picture or paint on its mask.'] },
    ],
    related: ['import-images', 'materials', 'masks'],
  },
  {
    id: 'drop-on-mesh', title: 'Putting a material on one part', cat: 'Layers & materials',
    sum: 'Drop a material on a part and it only goes on that part.',
    tags: ['material', 'fill', 'mask'], words: 'part piece only one section handle blade object id drop on mesh specific area',
    body: [
      { steps: ['Drag a material from the shelf over the model. The part under the cursor lights up.', 'Let go. The new fill layer gets a mask that only covers that part.', 'You can also use G (polygon fill) on a mask.'] },
    ],
    related: ['poly-fill', 'masks'],
  },
  {
    id: 'from-substance', title: 'Bring a Substance material into LocalPaint as pictures', cat: 'Layers & materials',
    sum: 'No Substance Designer? Export the material from Painter as pictures and drop those in.',
    tags: ['substance', 'import', 'material', 'image', 'export'],
    words: 'substance painter sbsar spsm smart material exact same look identical copy convert bake export textures adobe my own',
    body: [
      { p: 'If you have Substance 3D Designer, you don\'t need this: just drop the .sbsar in (see "Substance materials"). Without it, LocalPaint uses its own version of the material. When that isn\'t close enough, let Painter make the pictures and give those to LocalPaint.' },
      { h: 'In Substance Painter', steps: [
        'Make a new project with a flat plane (a 1 × 1 plane from Blender works) and a texture size like 2048.',
        'Drag the material or smart material onto it.',
        'File > Export Textures. Pick the "PBR Metallic Roughness" preset, choose a folder and click Export.',
      ] },
      { h: 'In LocalPaint', steps: [
        'Drag all the exported pictures onto LocalPaint at once (or Ctrl+I and pick them).',
        'LocalPaint recognises Base Color, Roughness, Metallic, Normal and Height from the names. Choose "New fill layer".',
        'In Properties set the tiling and switch Projection to Tri-planar so it wraps around your model without seams.',
      ] },
      { tips: ['Choose "Add to Assets shelf only" instead, and the material stays on your shelf to use again.', 'Want smart-material wear on top? Add LocalPaint\'s smart masks (edge wear, dirt) to the layer afterwards.'] },
    ],
    show: [{ label: 'Import pictures', act: 'import' }],
    related: ['import-images', 'materials'],
  },
  {
    id: 'scanned', title: 'Scanned materials', cat: 'Layers & materials',
    sum: 'Real photo-scanned materials that download when you first use them.',
    tags: ['material', 'smart', 'image'], words: 'scan scanned photo realistic real download cloud ambientcg metal rust wood stone concrete fabric leather plastic pbr',
    body: [
      { steps: [
        'Open Scanned materials on the Assets shelf. The ones marked with a download size aren\'t on your PC yet.',
        'Click one or drag it onto the model. The first time, LocalPaint downloads it (a few MB) and keeps it for next time.',
        'It comes in as a fill layer with real colour, roughness, metal, normal and height maps. Add masks to wear it in.',
      ] },
      { tips: ['These are free CC0 scans from ambientCG.com.', 'The "Realistic" smart materials are built from these scans.'] },
    ],
    show: [{ label: 'Scanned materials', act: 'shelf:cloud', hl: '.shelf-sec', text: 'Scanned materials' }],
    related: ['smart-materials', 'materials'],
  },
  {
    id: 'substance-files', title: 'Substance materials (.sbsar, .spsm)', cat: 'Layers & materials',
    sum: 'Drop an .sbsar in and change its settings like in Painter.',
    tags: ['substance', 'import', 'material'], words: 'sbsar spsm substance painter designer adobe sbsrender engine material mode preset seed parameters sliders simple diffuse stylized hand painted exact same look',
    body: [
      { steps: [
        'Drag an .sbsar onto LocalPaint, or click one under Substance materials on the shelf. Your Substance Painter materials are listed there already.',
        'It becomes a fill layer. Properties shows its settings the way Painter does: Preset, Seed, then its groups (open one to see its sliders).',
        'Pick a preset or move the sliders. The model updates as you go.',
        'If the material uses mesh maps (ambient occlusion, curvature, world normals, position), bake them in the Baking tab first. LocalPaint plugs them in for you.',
      ] },
      { h: 'Exact or close?', steps: [
        'The coloured tag under the name tells you. Green, "Adobe\'s engine": it looks exactly like in Painter.',
        'Purple, "LocalPaint\'s version": LocalPaint has its own copy of this material (Simple Diffuse, for example), so every slider works.',
        'Orange, "approximation": LocalPaint builds a stand-in from the material\'s name and sliders. Close, not identical.',
      ] },
      { h: 'Using Adobe\'s engine', steps: [
        'Adobe\'s renderer (sbsrender.exe) comes with Substance 3D Designer. If Designer is installed, LocalPaint finds it on its own.',
        'If it\'s somewhere unusual, go to File > Settings > Substance materials and click Find sbsrender.exe.',
        'Each change takes a second or two to render, since Adobe\'s program runs in the background.',
      ] },
      { tips: ['Tiling materials are put on with tri-planar projection so there are no seams. Switch to UV in Projection if you want Painter\'s default.', 'Channels at the bottom of Properties says which output goes where. Set one to "Not used" to leave that channel alone.', '.spsm smart materials are rebuilt as LocalPaint layers with masks.'] },
    ],
    show: [{ label: 'Substance materials', act: 'shelf:unsupported', hl: '.shelf-sec', text: 'Substance materials' }],
    related: ['from-substance', 'baking', 'materials'],
  },

  // ------------------------------------------------------------------ baking
  {
    id: 'baking', title: 'Baking mesh maps', cat: 'Baking',
    sum: 'Normal, AO, curvature and other maps that smart materials need.',
    tags: ['bake'], words: 'bake baking mesh maps normal ambient occlusion ao curvature thickness position world space id high poly low poly cage ray distance details',
    body: [
      { steps: [
        'Click Baking at the top right.',
        'Tick the maps you want (leaving them all on is fine) and pick a size.',
        'If you have a high poly version of the model, click Load high poly to bake its detail. If parts come out missing, raise Ray distance (cage).',
        'Click Bake selected textures. You can see the progress at the bottom left and on the model.',
        'Press Esc to go back to painting.',
      ] },
      { h: 'Speed', steps: [
        'Ambient occlusion, curvature and thickness are traced on the graphics card ("Bake on the graphics card" under Common parameters). It\'s on by default.',
        'Bake at 1K or 2K while you set things up and save 4K for the final bake.',
        'Fewer AO rays (Ambient occlusion settings) bake faster but look grainier.',
      ] },
      { tips: ['Smart materials and smart masks use these maps.'] },
    ],
    show: [{ label: 'Baking', act: 'mode:bake' }],
    related: ['bake-settings', 'smart-materials', 'smart-masks'],
  },
  {
    id: 'bake-settings', title: 'Baking settings (bake by mesh name and more)', cat: 'Baking',
    sum: 'Match high and low poly by mesh name, keep parts from shadowing each other, and fine-tune every map.',
    tags: ['bake'], words: 'bake baking settings mesh name by mesh name match matching suffix _low _high low poly high poly ignorebf ignore backface back face self occlusion only same mesh name self intersection ground plane offset position axis normalization bounding box sphere thickness spread distribution restore defaults overlap parts touching bleeding exploded explode',
    body: [
      { p: 'Click Baking at the top right, then click Common parameters or a map in the list on the left to see its settings.' },
      { h: 'Bake by mesh name', steps: [
        'In your 3D program, name each part with a suffix: Body_low and Body_high, Helmet_low and Helmet_high, and so on.',
        'In Common parameters > Matching by mesh name, set Match to By mesh name.',
        'Each low poly part now only takes detail from the high poly part with the same name. Parts that sit close together stop baking onto each other, so you don\'t need to explode the model.',
        'The note under the settings says how many low poly parts found a high poly partner, and lists the ones that didn\'t.',
        'Your names use other suffixes? Change Low poly suffix and High poly suffix to match (for example _lp and _hp).',
      ] },
      { h: 'Only same mesh name (AO, curvature, thickness)', steps: [
        'Ambient occlusion > Self occlusion: Only same mesh name means a part is only darkened by itself, not by the parts next to it.',
        'Curvature > Self intersection: Only same mesh name stops edges showing where two parts just touch.',
        'Thickness > Self occlusion does the same for thickness.',
        'This works with or without a high poly, as long as the parts are separate, named meshes.',
      ] },
      { h: 'Ignore backface', steps: [
        'Ambient occlusion > Ignore backface: Never (the default), Always, or By mesh name.',
        'By mesh name only applies to meshes whose name contains the Ignore backface suffix (_ignorebf), handy for single-sided planes like leaves or cloth.',
        'For high poly baking, tick Ignore backface under Ray distance (cage) so rays skip high poly faces seen from behind.',
      ] },
      { h: 'Other settings', steps: [
        'Ambient occlusion: Ground plane adds a floor under the model; Ground plane offset moves it up or down.',
        'Position: Mode picks all axes (color) or one axis (gray). Normalization: Bounding box stretches each axis to fill the map, Bounding sphere keeps the same scale on every axis, None keeps the raw position.',
        'Thickness: min and max distance, spread angle and distribution, like ambient occlusion.',
        'Restore defaults at the bottom of a map\'s settings puts it back to Substance Painter\'s defaults.',
      ] },
      { tips: ['The maps you tick are remembered for your next project.', 'Smart masks and generators read these maps, so re-bake after changing a setting.'] },
    ],
    show: [{ label: 'Baking', act: 'mode:bake' }],
    related: ['baking', 'smart-masks'],
  },

  // ------------------------------------------------------------------ designer
  {
    id: 'designer', title: 'Material Designer and Shader Maker', cat: 'Material Designer',
    sum: 'Make your own tiling materials with nodes.',
    tags: ['designer', 'material'], words: 'node nodes graph designer procedural noise pattern shader maker script code glsl make my own custom material generator',
    body: [
      { steps: [
        'Click Material Designer at the top right.',
        'Add nodes (noise, patterns, blend, levels and so on) and connect them to the outputs.',
        'The result shows on the model right away as a fill layer.',
        'Shader Maker lets you write a small shader for things the nodes can\'t do.',
      ] },
    ],
    show: [{ label: 'Material Designer', act: 'mode:design' }],
  },

  // ------------------------------------------------------------------ export
  {
    id: 'export', title: 'Exporting textures', cat: 'Export',
    sum: 'Ctrl+Shift+E opens the export window. Pick a template for your engine or 3D program and export.',
    tags: ['export'], words: 'export save textures png jpg tga 16 bit images output maps finished done unity urp hdrp unreal godot blender maya 3ds max arnold vray redshift gltf glb sketchfab usd roblox template padding dilation output directory channel pack orm',
    body: [
      { steps: [
        'Press Ctrl+Shift+E, or the export button on the right edge.',
        'Output template: pick where the textures are going. There are templates for Unity (Built-in, URP, HDRP), Unreal, Godot, Roblox, Blender, Maya / 3ds Max (Arnold), V-Ray, Redshift, glTF, Sketchfab, USD and more.',
        'Pick the file type (png, jpg, tga; png can be 16 bits), the size and the padding.',
        'Check the output directory (on the desktop app it starts as D:\\LocalPaint\\export when you have a D: drive) and click Export.',
        'List of exports shows each file and a console with what happened.',
      ] },
      { h: 'Your own template', steps: [
        'Open the Output templates tab, pick a template close to what you want and click + to make a copy.',
        'Add outputs with the Gray / RGB / R+G+B / RGB+A / R+G+B+A buttons.',
        'Drag maps from the right (base color, roughness, AO, converted maps like glossiness…) onto each output\'s channels. You can also click a channel and then a map.',
        'Name files with $textureSet, e.g. $textureSet_ORM. Save settings keeps it for next time.',
      ] },
    ],
    show: [{ label: 'Export', act: 'export' }],
    related: ['roblox'],
  },
  {
    id: 'roblox', title: 'Exporting for Roblox', cat: 'Export',
    sum: 'Textures for a SurfaceAppearance, up to 1024.',
    tags: ['export', 'roblox'], words: 'roblox studio surfaceappearance surface appearance pbr meshpart colormap normalmap roughnessmap metalnessmap',
    body: [
      { steps: [
        'Press Ctrl+Shift+E and choose Roblox (SurfaceAppearance) as the output template.',
        'Roblox only allows textures up to 1024 x 1024, so LocalPaint keeps the size at or below that.',
        'In Roblox Studio, put a SurfaceAppearance inside your MeshPart and set ColorMap, NormalMap, RoughnessMap and MetalnessMap to the exported files.',
        'If you painted glow, use the EmissiveMask file and set EmissiveStrength and EmissiveTint.',
      ] },
    ],
    show: [{ label: 'Export', act: 'export' }],
  },

  // ------------------------------------------------------------------ help & settings
  {
    id: 'display', title: 'Lighting and display', cat: 'Help & settings',
    sum: 'Environment light, background and tone mapping.',
    tags: ['display'], words: 'light lighting environment hdr hdri background dark bright exposure tone mapping view look shadows sun rotate turn move light direction highlight shift right drag',
    body: [
      { steps: ['Click Display settings on the right edge (or Viewport > Display settings).', 'Pick an environment, or drop in your own .hdr file.', 'Change the exposure, rotation and tone mapping.'] },
      { h: 'Move the light', p: 'Hold Shift and right-drag in the 3D view. Left and right swings the light around the model, up and down raises or lowers it. The Rotation and Light height sliders in Display settings do the same, and LocalPaint remembers where you left it. Reset lighting puts it back to the start.' },
    ],
    show: [{ label: 'Display settings', act: 'display' }],
  },
  {
    id: 'settings', title: 'Settings', cat: 'Help & settings',
    sum: 'Autosave, texture size, render scale, undo steps and low performance mode.',
    tags: ['settings', 'performance'], words: 'settings options preferences config configure change default size',
    body: [
      { p: 'Go to File > Settings. Changes are kept for next time.' },
    ],
    show: [{ label: 'Settings', act: 'settings' }],
    related: ['performance'],
  },
  {
    id: 'performance', title: 'LocalPaint is slow or laggy', cat: 'Help & settings',
    sum: 'Things you can turn down to make it run better.',
    tags: ['performance'], words: 'slow lag laggy lagging stutter freeze fps weak computer device laptop old pc fast faster speed performance low end crash memory',
    body: [
      { steps: [
        'Turn on Low performance mode in File > Settings.',
        'Set Render scale to 1x.',
        'Use 1024 or 2048 textures instead of 4096.',
        'Lower the undo steps. Fewer steps use less memory.',
      ] },
    ],
    show: [{ label: 'Settings', act: 'settings' }],
    related: ['settings'],
  },
  {
    id: 'updates', title: 'Updating LocalPaint', cat: 'Help & settings',
    sum: 'LocalPaint checks for new versions and can update itself.',
    tags: ['update', 'settings'], words: 'update updates upgrade new version newer latest outdated out of date download github release check',
    body: [
      { steps: [
        'When LocalPaint starts it asks GitHub if there is a newer version. If there is, a window tells you what\'s new.',
        'Click Update now. LocalPaint downloads only the changed files (a few MB), then restarts. Your projects and autosaves aren\'t touched.',
        'If you click Later, an orange Update button stays in the top bar next to the Guide button until you update.',
        'You can check yourself any time with File > Check for updates, and turn the start check off in File > Settings.',
      ] },
      { tips: ['The full download page is github.com/LeoDevRX/LMP/releases.'] },
    ],
    show: [{ label: 'Check for updates', act: 'updates' }],
  },
  {
    id: 'view-pie', title: 'Jump to front, top, side views', cat: 'Basics',
    sum: 'Hold ~ for a ring of views, like Blender.',
    tags: ['view', 'camera', 'shortcut'], words: 'blender pie tilde ~ backtick front back left right top bottom view camera snap orthographic numpad angle frame zoom fit',
    body: [{ steps: [
      'Put the mouse over the 3D view and hold the ~ key (left of 1).',
      'A ring of views pops up around the mouse: Top, Bottom, Left, Right, Front, Back, a 3/4 view and Frame model.',
      'Move the mouse toward the one you want and let go of ~. The camera swings there and zooms to fit the model.',
    ] }, { tips: ['Just tap ~ and the ring stays open, so you can click a view instead.', 'Esc closes it.'] }],
    related: ['shortcuts'],
  },
  {
    id: 'errors', title: 'Help: errors', cat: 'Help & settings',
    sum: 'What the error messages mean and what to do about them.',
    tags: ['import', 'open', 'crash'], words: 'error errors message problem broken failed fail failing couldn\'t cant won\'t translate read offset outside bounds dataview spsm sbsar spp corrupt damaged incomplete unsupported paid help warning red',
    body: [
      { h: 'Couldn\'t translate … / LocalPaint couldn\'t read …', p: 'LocalPaint opened a Substance file (.spsm, .spmsk) but part of it is stored in a way it doesn\'t understand yet. Often it\'s a paid or newer Substance material packed inside the smart material; it can also mean the file was cut short while copying. LocalPaint brings in every layer it can read and lists the ones it skipped. Try exporting the smart material again, or rebuild the skipped layer with a LocalPaint material.' },
      { h: 'Offset is outside the bounds of the DataView', p: 'The same thing in technical words: the file ended, or a part of it pointed past its end, while LocalPaint was reading it. Not something you did wrong.' },
      { h: 'Substance Painter projects are not supported', p: 'LocalPaint can\'t open .spp project files (Adobe\'s format is closed). Export the textures from Painter (File > Export Textures), open the same model in LocalPaint and drop the textures in. To keep the layers, group them in Painter, right-click the folder > Create smart material, and drop that .spsm into LocalPaint.' },
      { h: '… isn\'t a smart material file Substance Painter 2018 or newer wrote', p: 'The .spsm is from a very old Painter, or isn\'t really a smart material. Open it in a newer Painter and save it again.' },
      { h: '… has no layer stack inside / no layers LocalPaint can use', p: 'The smart material is empty, or only holds things LocalPaint can\'t show yet (hand painting, filters, anchors). Nothing is added.' },
      { h: 'Could not read that image / HDR file', p: 'The file is damaged or in a format LocalPaint can\'t open. Save it again as PNG, JPG, EXR or HDR and try once more.' },
      { h: 'Could not load that brush tip', p: 'The brush\'s picture is missing or damaged. Pick another tip in Properties > Brush tip, or re-import the picture.' },
      { h: 'A scan or grunge won\'t download', p: 'Scanned materials and grunges download the first time you use them. Check your internet connection; until it\'s back, LocalPaint uses a stand-in so you can keep working.' },
      { tips: ['Something else? Note down the exact message and what you were doing when it showed up.'] },
    ],
    related: ['substance-files', 'shortcuts'],
  },
  {
    id: 'shortcuts', title: 'Keyboard shortcuts', cat: 'Help & settings',
    sum: 'All the keys in one list.',
    tags: ['shortcut'], words: 'keys keyboard shortcuts hotkeys hotkey controls list buttons',
    body: [{ p: 'Click the button below to see the full list.' }],
    show: [{ label: 'Shortcuts', act: 'shortcuts' }],
  },
];

// ====================================================================== search

/** Concept → the words people actually type for it. */
const SYN: Record<string, string[]> = {
  smoothing: ['smooth', 'smoothly', 'smoothing', 'steady', 'stable', 'stabilize', 'stabilizer', 'stabiliser', 'shaky', 'wobbly', 'wobble', 'jitter', 'jittery', 'lazy', 'string', 'trail', 'neat', 'clean', 'shake', 'precise'],
  path: ['path', 'paths', 'bezier', 'curve', 'curves', 'curved', 'spline', 'follow', 'following', 'guide', 'guiding', 'along', 'trace', 'route', 'seam', 'stitch', 'stitches'],
  line: ['line', 'lines', 'straight', 'ruler', 'connect'],
  undo: ['undo', 'undid', 'mistake', 'oops', 'revert', 'back', 'previous', 'before', 'earlier', 'redo', 'accidentally', 'accident', 'wrong'],
  history: ['history', 'steps', 'jump', 'list'],
  autosave: ['autosave', 'autosaved', 'backup', 'backups', 'auto'],
  recover: ['recover', 'recovery', 'restore', 'lost', 'lose', 'rescue', 'gone', 'disappeared'],
  crash: ['crash', 'crashed', 'crashes', 'closed', 'froze', 'freeze', 'shutdown'],
  save: ['save', 'saving', 'saved', 'keep', 'store'],
  open: ['open', 'opening', 'load', 'reopen', 'recent'],
  new: ['new', 'start', 'fresh', 'begin', 'create', 'blank'],
  model: ['model', 'mesh', 'fbx', 'obj', 'glb', 'gltf', 'object', 'character', '3d'],
  import: ['import', 'drag', 'drop', 'bring', 'insert'],
  image: ['image', 'images', 'png', 'jpg', 'jpeg', 'photo', 'picture', 'texture', 'textures', 'decal', 'sticker', 'logo'],
  symmetry: ['symmetry', 'symmetric', 'mirror', 'mirrored', 'mirroring', 'both', 'sides', 'flip', 'reflect'],
  pressure: ['pressure', 'pen', 'tablet', 'wacom', 'huion', 'stylus', 'sensitivity', 'sensitive'],
  picker: ['picker', 'eyedropper', 'dropper', 'pick', 'sample', 'grab', 'eye'],
  color: ['color', 'colour', 'colors', 'colours', 'paint', 'tint', 'hue'],
  erase: ['erase', 'eraser', 'rubber', 'remove', 'wipe'],
  brush: ['brush', 'brushes', 'stroke', 'strokes', 'draw', 'drawing'],
  alpha: ['alpha', 'alphas', 'stamp', 'tip', 'tips', 'grunge', 'splatter'],
  shape: ['shape', 'shapes', 'circle', 'square', 'star', 'heart', 'triangle', 'hexagon', 'ring', 'diamond', 'decal', 'sticker', 'generator', 'disc', 'capsule', 'brick', 'bell', 'gaussian'],
  anchor: ['anchor', 'anchors', 'micro', 'microdetail', 'microdetails'],
  size: ['size', 'bigger', 'smaller', 'radius', 'resize', 'big', 'small', 'width', 'thick', 'thin'],
  flow: ['flow', 'build', 'buildup'],
  opacity: ['opacity', 'transparent', 'transparency', 'faint', 'strength', 'see'],
  paint: ['paint', 'painting', 'draw', 'colour'],
  fill: ['fill', 'shape', 'shapes', 'circle', 'star', 'heart', 'decal', 'sticker', 'bucket', 'polygon', 'island', 'part', 'parts', 'whole', 'triangle', 'face'],
  layer: ['layer', 'layers', 'folder', 'group', 'blend', 'stack', 'order', 'reorder'],
  mask: ['mask', 'masks', 'masking', 'hide', 'reveal', 'only', 'black', 'white'],
  smart: ['smart', 'automatic', 'auto', 'procedural', 'generator'],
  wear: ['wear', 'worn', 'rust', 'rusty', 'dirt', 'dirty', 'scratch', 'scratches', 'scratched', 'old', 'aged', 'weathered', 'damage', 'damaged', 'edges', 'edge', 'cavity', 'dust', 'grime'],
  material: ['material', 'materials', 'pbr', 'metal', 'wood', 'stone', 'leather', 'plastic', 'fabric', 'gold', 'concrete'],
  bake: ['bake', 'baking', 'baked', 'normal', 'ao', 'occlusion', 'curvature', 'thickness', 'highpoly', 'cage', 'ray'],
  designer: ['designer', 'node', 'nodes', 'graph', 'graphs', 'shader', 'script', 'scripting', 'code', 'glsl', 'custom'],
  export: ['export', 'exporting', 'output', 'unity', 'unreal', 'blender', 'godot', 'engine', 'game', 'finished', 'done'],
  roblox: ['roblox', 'studio', 'surfaceappearance', 'meshpart', 'rbx'],
  display: ['display', 'light', 'lighting', 'environment', 'hdr', 'hdri', 'background', 'exposure', 'dark', 'bright', 'tone'],
  camera: ['camera', 'rotate', 'orbit', 'turn', 'spin', 'pan', 'zoom', 'frame', 'center', 'focus', 'around', 'navigate', 'move'],
  view: ['view', 'views', 'front', 'top', 'side'],
  layout: ['layout', '2d', 'split', 'fullscreen'],
  uv: ['uv', 'uvs', 'unwrap', 'flat', 'wireframe', 'overlap', 'overlapping', 'overlaps', 'stacked'],
  settings: ['settings', 'setting', 'options', 'preferences', 'config', 'configure', 'default'],
  performance: ['performance', 'slow', 'lag', 'laggy', 'lagging', 'stutter', 'fps', 'weak', 'laptop', 'speed', 'faster', 'fast', 'heavy', 'memory'],
  shortcut: ['shortcut', 'shortcuts', 'hotkey', 'hotkeys', 'keys', 'keyboard', 'key'],
  substance: ['substance', 'sbsar', 'spsm', 'adobe', 'painter'],
  start: ['start', 'started', 'begin', 'beginner', 'tutorial', 'intro', 'learn', 'basics', 'first', 'howto', 'help', 'welcome'],
  setup: ['setup', 'set', 'install', 'configure'],
  about: ['about', 'credits', 'credit', 'owner', 'owned', 'author', 'made', 'creator', 'version', 'leodevrx', 'leo', 'github', 'localpaint', 'lmp'],
  update: ['update', 'updates', 'updating', 'upgrade', 'changelog', 'changes', 'whats', 'latest', 'release', 'outdated', 'version', 'newer'],
  tip: ['tip', 'tips'],
};

/** Multi-word phrases that mean one thing. */
const PHRASES: [RegExp, string[]][] = [
  [/go(ing)? back|step back|take back|ctrl ?\+? ?z|before i|earlier version|undo/, ['undo', 'history']],
  [/straight line/, ['line']],
  [/(follow|along|guid\w*|trac\w*) (a |the )?(path|line|curve|edge|seam)/, ['path', 'smoothing']],
  [/lazy mouse|steady hand|shaky hand/, ['smoothing']],
  [/eye ?drop|colou?r pick|pick (a |the )?colou?r/, ['picker']],
  [/edge wear|worn edges/, ['wear', 'smart']],
  [/smart mat/, ['smart', 'material']],
  [/smart mask/, ['smart', 'mask']],
  [/anchor point|micro ?details?|wear (around|follow)|react to (my )?(paint|details?|shapes?)/, ['anchor']],
  [/low (performance|end)|too (slow|weak)|runs? (slow|bad)/, ['performance']],
  [/pen pressure|drawing tablet/, ['pressure']],
  [/both sides|other side/, ['symmetry']],
  [/(lost|lose) (my )?work|didn'?t save|not saved|closed (by )?accident/, ['recover', 'autosave']],
  [/high poly/, ['bake']],
  [/normal map/, ['bake', 'image']],
  [/what'?s new|new features?/, ['update']],
  [/who (made|owns|created)/, ['about']],
  [/getting started|how (does|do) (this|it|lmp) work|get started/, ['start']],
];

const STOP = new Set(('i me my mine you your it its it\'s a an the to of in on at for from with and or but so if is are am be was were do does did doing ' +
  'how what why when where which who can could would should will want wanna need like just make made makes get got go goes going ' +
  'this that these those there here some any thing things way ways there\'s please help lmp im i\'m into out up down by as than then ' +
  'also really very much more most maybe idk let lets use using used one').split(' '));

const norm = (s: string) => s.toLowerCase().replace(/[’']/g, '\'').replace(/[^a-z0-9_'+ ]+/g, ' ').replace(/\s+/g, ' ').trim();
function stem(w: string) {
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith('ly')) return w.slice(0, -2);
  if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2);
  if (w.length > 4 && w.endsWith('es')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}
function lev(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, cur[j]);
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}
/** How well a typed word matches a known word: 1 exact, less for prefixes and typos, 0 none. */
function wordMatch(q: string, w: string): number {
  if (q === w) return 1;
  const sq = stem(q), sw = stem(w);
  if (sq === sw) return 0.95;
  if (sq.length >= 3 && sw.startsWith(sq)) return 0.7;          // still typing
  if (sq.length >= 5 && sw.length >= 5 && (sw.includes(sq) || sq.includes(sw))) return 0.6;
  if (sq.length >= 4 && sq.length === sw.length) {
    const d = [...sq].reduce<number[]>((a, c, i) => (c !== sw[i] ? [...a, i] : a), []);
    if (d.length === 2 && d[1] === d[0] + 1 && sq[d[0]] === sw[d[1]] && sq[d[1]] === sw[d[0]]) return 0.8; // swapped letters
  }
  const max = sq.length >= 7 ? 2 : sq.length >= 4 ? 1 : 0;
  if (max && lev(sq, sw, max) <= max) return 0.75;              // typo
  return 0;
}

interface Indexed { g: Guide; title: string[]; tags: Set<string>; words: string[]; body: string[] }
let INDEX: Indexed[] | null = null;
const SYN_WORDS: [string, string][] = Object.entries(SYN).flatMap(([c, ws]) => ws.map((w) => [w, c] as [string, string]));
function tokens(s: string) { return norm(s.replace(/\*\*/g, '')).split(' ').filter((w) => w && !STOP.has(w)); }
function index(): Indexed[] {
  return (INDEX ??= GUIDES.map((g) => ({
    g, title: tokens(g.title + ' ' + g.sum), tags: new Set(g.tags), words: tokens(g.words ?? ''),
    body: tokens(g.body.map((b) => [b.h, b.p, ...(b.steps ?? []), ...(b.tips ?? []), ...(b.table ?? []).flat()].filter(Boolean).join(' ')).join(' ')),
  })));
}
/** Concepts a word stands for (with match strength). */
function concepts(w: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const [sw, c] of SYN_WORDS) {
    const m = wordMatch(w, sw);
    if (m > (out.get(c) ?? 0)) out.set(c, m);
  }
  return out;
}
const best = (q: string, list: string[]) => list.reduce((m, w) => Math.max(m, wordMatch(q, w)), 0);

export interface GuideHit { g: Guide; score: number }
/** Rank guides for a question typed in everyday words. */
export function searchGuides(query: string, limit = 8): GuideHit[] {
  const q = norm(query);
  if (!q) return [];
  const words = tokens(q);
  const phraseTags = new Set<string>();
  for (const [re, tags] of PHRASES) if (re.test(q)) tags.forEach((t) => phraseTags.add(t));
  const wordConcepts = words.map(concepts);
  const hits: GuideHit[] = [];
  for (const ix of index()) {
    let score = 0;
    for (const t of phraseTags) if (ix.tags.has(t)) score += 5;
    words.forEach((w, i) => {
      let s = 0;
      for (const [c, m] of wordConcepts[i]) if (ix.tags.has(c)) s = Math.max(s, 3 * m);
      s = Math.max(s, 3.5 * best(w, ix.title), 2.5 * best(w, ix.words), 1 * best(w, ix.body));
      score += s;
    });
    // Answers that cover more of the question beat ones that match one word very well.
    const covered = words.filter((w, i) => [...wordConcepts[i].keys()].some((c) => ix.tags.has(c)) || best(w, ix.title) || best(w, ix.words) > 0.6).length;
    if (words.length > 1) score *= 0.6 + 0.4 * (covered / words.length);
    // "What's new" mentions everything; only rank it high when asked about updates.
    if (ix.g.id === 'whats-new' && !words.some((_, i) => wordConcepts[i].has('update'))) score *= 0.5;
    if (score > 1.2) hits.push({ g: ix.g, score });
  }
  hits.sort((a, b) => b.score - a.score);
  // Keep the clear answers: drop results far below the best one.
  const top = hits[0]?.score ?? 0;
  return hits.filter((h) => h.score >= top * 0.3).slice(0, limit);
}

export const guideById = (id: string) => GUIDES.find((g) => g.id === id);

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
/** **bold** → <b>, keys like Ctrl+S / F1 → <kbd>. */
export function fmt(s: string): string {
  return esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/\[([^\]]+)\]\((https:\/\/github\.com\/[^)\s"]+)\)/g, '<a href="$2" target="_blank" rel="noopener" class="link">$1</a>');
}

// ====================================================================== walkthrough tours

/**
 * One step of a "Walk me through it" tour. The pointer goes to `at` (a CSS selector; `has` picks the
 * match whose text contains it) and the bubble under it says `t`. `wait` says when the step is done:
 * 'next' (the Next button), 'click' / 'rclick' on the target, 'key:Escape', or 'state:<name>' (the app checks).
 * `act` runs first (same actions as the "Show me" buttons).
 */
export interface TourStep { t: string; at?: string; has?: string; wait?: string; act?: string; /** Skip the step when this state is already true. */ skip?: string }

export const TOURS: Record<string, TourStep[]> = {
  'getting-started': [
    { at: '#shelf', t: 'This is the Assets shelf: models, smart materials, materials, brushes and more. Drag things from here onto the model.' },
    { at: '#viewport > canvas', t: 'Your model. Right mouse drag to turn it, middle mouse to move, wheel to zoom. Paint with the left mouse button.' },
    { at: '#toolstrip', t: 'Your tools: brush, eraser, polygon fill, path, picker, the mask button and History.' },
    { at: '#toolbar', t: 'Settings for the tool you have, like brush size, flow and smoothing.' },
    { at: '#right', t: 'Layers on top, and Properties below for whatever you selected.' },
    { at: '#mode-tabs', t: 'Switch to Baking before using smart materials, and Material Designer to make your own materials.' },
    { at: '#guide-btn', t: 'Stuck? Press F1 or click Guide and type your question.' },
  ],
  'paint-basics': [
    { at: '#toolstrip button[title^="Paint"]', t: 'Click the brush (or press B).', wait: 'click' },
    { at: '#right .layer', has: 'Layer', t: 'Make sure a paint layer is selected. Click it.', wait: 'click' },
    { at: '#right .group', has: 'Material', t: 'Here you choose what the brush paints: colour, roughness, metal and more.' },
    { at: '#viewport > canvas', t: 'Now paint on the model with the left mouse button.', wait: 'state:stroke' },
    { at: '#toolbar .tb-scroll', t: 'Change size, flow and hardness here. [ and ] change the size too.' },
  ],
  'lazy-mouse': [
    { act: 'tool:paint', at: '#toolbar .inline-slider', has: 'Smoothing', t: 'Turn up Smoothing. Around 30 is a good start.', wait: 'state:smoothing' },
    { at: '#viewport > canvas', t: 'Paint a line. The dotted string pulls the brush along behind your mouse, so it comes out steady.', wait: 'state:stroke' },
    { at: '#toolbar .inline-slider', has: 'Smoothing', t: 'Set it back to off when you want normal painting.' },
  ],
  'path-tool': [
    { at: '#toolstrip button[title^="Path"]', t: 'Click the Path tool (or press L).', wait: 'click' },
    { at: '#viewport > canvas', t: 'Click on the model to add points. Click and drag to bend the curve.', wait: 'state:path2' },
    { at: '#viewport > canvas', t: 'The brush follows the curve while you edit. Drag points to change it.' },
    { at: '#toolbar button.primary', has: 'Finish', t: 'Click Finish (or press Enter) to keep it.', wait: 'state:pathdone' },
  ],
  'symmetry': [
    { act: 'tool:paint', at: '#toolbar .sym-wrap', t: 'Click X to mirror left and right.', wait: 'state:sym' },
    { at: '#viewport > canvas', t: 'The red line is the mirror. Paint on one side and the other side gets it too.', wait: 'state:stroke' },
  ],
  'history': [
    { at: '#toolstrip button[title^="History"]', t: 'Click History (or press H).', wait: 'state:history' },
    { at: '#shelf .hist-row', t: 'Your recent changes, newest at the top. Click one to go back to it.' },
    { at: '#shelf .hist-row.original', t: '"Original" is how the file was before all of these.' },
    { at: '#shelf .hist-row', t: 'Went back too far? Click the top row to get your latest version back.' },
  ],
  'masks': [
    { at: '#right .layer', t: 'Right click the layer you want to hide in places.', wait: 'rclick' },
    { at: '#ctx-menu button', has: 'Add black mask', t: 'Choose Add black mask. The layer disappears for now.', wait: 'state:masktarget' },
    { at: '#viewport > canvas', t: 'Paint white where you want the layer to show.', wait: 'state:stroke' },
    { at: '#toolstrip', t: 'Press M (or the mask button) to switch between painting the mask and the layer.' },
  ],
  'shapes': [
    { at: '#right .layer', t: 'Right click the layer you want to put a shape on.', wait: 'rclick' },
    { at: '#ctx-menu button', has: 'Shape (circle', t: 'Under Add generator, choose Shape (circle, star…).', wait: 'state:shape' },
    { at: '#viewport > canvas', t: 'Drag on the model to move the shape where you want it.', wait: 'state:shapemoved' },
    { at: '#right .row', has: 'Shape', t: 'Pick a different shape here. Size, stretch and rotation are just below.' },
    { at: '#toolbar button.primary', has: 'Done', t: 'Click Done (or press Esc) when it\'s in place.', wait: 'state:shapedone' },
  ],
  'smart-materials': [
    { at: '#mode-tabs button', has: 'Baking', t: 'First bake the mesh maps, so the wear lands on the edges. Click Baking.', wait: 'state:bakemode', skip: 'baked' },
    { at: 'button.primary.big', has: 'Bake selected', t: 'Click Bake selected textures and wait for it to finish.', wait: 'state:baked', skip: 'baked' },
    { at: '#mode-tabs button', has: 'Painting', t: 'Go back to Painting.', wait: 'state:paintmode', skip: 'paintmode' },
    { act: 'shelf:smart', at: '.shelf-sec', has: 'Smart materials', t: 'Here are the smart materials.' },
    { at: '#shelf .tile', t: 'Drag one onto the model (or click it).', wait: 'state:morelayers' },
    { at: '#right', t: 'It came in as a folder of layers. Open it to change the colours or the masks.' },
  ],
  'baking': [
    { at: '#mode-tabs button', has: 'Baking', t: 'Click Baking.', wait: 'state:bakemode' },
    { at: '#shelf', t: 'Tick the maps you want. Leaving them all on is fine.' },
    { at: 'button.primary.big', has: 'Bake selected', t: 'Click Bake selected textures.', wait: 'state:baking' },
    { at: '#status-bake', t: 'Progress shows here at the bottom. Wait for the tick marks.', wait: 'state:baked' },
    { at: '#mode-tabs button', has: 'Painting', t: 'Done. Go back to Painting.', wait: 'state:paintmode' },
  ],
  'export': [
    { at: '#sidestrip button[title^="Export"]', t: 'Click Export (or press Ctrl+Shift+E).', wait: 'state:export' },
    { at: '#export-dialog .exp-template', t: 'Pick where the textures are going: Unity, Unreal, Godot, Blender, Roblox and many more.' },
    { at: '#export-dialog .exp-go', t: 'Click Export.', wait: 'click' },
  ],
  'roblox': [
    { at: '#sidestrip button[title^="Export"]', t: 'Click Export (or press Ctrl+Shift+E).', wait: 'state:export' },
    { at: '#export-dialog .exp-template', t: 'Choose Roblox (SurfaceAppearance). LocalPaint keeps the size at 1024 for Roblox.' },
    { at: '#export-dialog .exp-go', t: 'Click Export. In Roblox Studio, put a SurfaceAppearance in your MeshPart and set its maps to these files.', wait: 'click' },
  ],
  'import-images': [
    { at: '#viewport', t: 'Drag your PNG or JPG files onto LocalPaint now, or press Ctrl+I.', wait: 'state:import' },
    { at: '.imp-list', t: 'For each picture choose what it is: Color, Normal, Height and so on.' },
    { at: '.lmp-modal-foot button.primary', t: 'Choose where it goes, then click to add it.', wait: 'click' },
  ],
  'uv-overlap': [
    { at: '#toolbar button[title^="UV overlaps"]', t: 'Click this button (or press O).', wait: 'state:overlap' },
    { at: '#viewport > canvas', t: 'Dark spots are faces whose UVs overlap. Fix those in Blender, then reopen the model.' },
  ],
  'updates': [
    { at: '.menu-btn', has: 'File', t: 'Open the File menu.', wait: 'state:menu' },
    { at: '.menu.open button', has: 'Check for updates', t: 'Click Check for updates.', wait: 'click' },
  ],
};

// ------------------------------------------------------------------ "Did you know" suggestions (under the Guide search bar)

/** A feature people often don't find on their own. Clicking it opens the guide `id`. */
export interface GuideTip { text: string; id: string }

export const GUIDE_TIPS: GuideTip[] = [
  { text: 'You can open Substance .sbsar materials and smart materials straight from Painter.', id: 'substance-files' },
  { text: 'Hold ~ and flick the mouse to jump to the front, back, side or top view.', id: 'view-pie' },
  { text: 'Smart materials like rust and worn paint put wear on the edges by themselves.', id: 'smart-materials' },
  { text: 'You can bake ambient occlusion, curvature and more right here, no other program needed.', id: 'baking' },
  { text: 'There are export templates for Unity, Unreal, Godot, Blender, Roblox and lots more.', id: 'export' },
  { text: 'You can make your own export template with exactly the maps your engine wants.', id: 'export' },
  { text: 'Roblox SurfaceAppearance textures come out at the right size and layout with one click.', id: 'roblox' },
  { text: 'Scanned materials are real photographed surfaces you can drop on your model.', id: 'scanned' },
  { text: 'The Material Designer lets you build your own materials from nodes.', id: 'designer' },
  { text: 'Mirror painting paints both sides of the model at once. Press X to turn it on.', id: 'symmetry' },
  { text: 'Lazy mouse makes hand-drawn lines and outlines much cleaner.', id: 'lazy-mouse' },
  { text: 'You can paint along a path and edit the curve afterwards.', id: 'path-tool' },
  { text: 'Hold Shift and click to draw a straight line between two points.', id: 'straight-lines' },
  { text: 'Drawing tablets work, and pen pressure can change size and strength.', id: 'pen-pressure' },
  { text: 'Drag a material onto one part of the model and it only goes on that part.', id: 'drop-on-mesh' },
  { text: 'Polygon fill (G) masks a whole part, a UV island or a face with one click.', id: 'poly-fill' },
  { text: 'Anchor points make wear and dirt follow the details you painted by hand.', id: 'anchors' },
  { text: 'A Shape generator puts a circle, star or heart on the model that you can drag around.', id: 'shapes' },
  { text: 'Smart masks add edge wear, dirt in gaps or dust on top to any layer.', id: 'smart-masks' },
  { text: 'Brush tips change the shape of every dab. A grunge tip looks like worn paint.', id: 'brush-tips' },
  { text: 'You can save your favourite brush settings as presets.', id: 'brushes' },
  { text: 'Hold Ctrl and scroll to resize the brush. Ctrl + right-drag sets hardness, Ctrl + left-drag the flow.', id: 'quick-adjust' },
  { text: 'You can paint flat on the UVs in the 2D view (F3 or F4).', id: 'paint-2d' },
  { text: 'Your own photos and textures can be used as materials, brush tips or masks.', id: 'import-images' },
  { text: 'LocalPaint can show you where UVs overlap, the cause of strange dark spots.', id: 'uv-overlap' },
  { text: 'The History panel lets you jump back to any step, not only the last one.', id: 'history' },
  { text: 'Autosave keeps several backups, so lost work can usually be brought back.', id: 'autosave' },
  { text: 'You can change the lighting and background to check your material.', id: 'display' },
  { text: 'Every layer has its own blend mode and opacity, like in Painter.', id: 'layers' },
  { text: 'LocalPaint updates itself when a new version is out.', id: 'updates' },
  { text: 'Low performance mode makes LocalPaint run on older laptops.', id: 'performance' },
  { text: 'There is a shortcut list for everything, Painter-style.', id: 'shortcuts' },
  { text: 'Fill layers cover the whole model with a material, and a mask decides where it shows.', id: 'materials' },
  { text: 'The eyedropper picks the whole material under the cursor, not just the colour.', id: 'picker' },
  { text: 'Flow builds paint up slowly; stroke opacity caps how strong one stroke can get.', id: 'flow-opacity' },
  { text: 'There is a quick tour of the screen on the Guide\'s home page.', id: 'getting-started' },
  { text: 'File > Export mesh saves your model as a GLB with the textures already inside it.', id: 'open-model' },
  { text: 'Painter\'s Dirt, Metal Edge Wear and Mask Editor generators are in LocalPaint, with the same settings.', id: 'smart-masks' },
  { text: 'You can drop a Painter smart mask (.spmsk) straight onto LocalPaint.', id: 'smart-masks' },
  { text: 'The New project window can bake the mesh maps for you as soon as the model is in.', id: 'open-model' },
];

/** The suggestions to show now. They change every hour (local time); `shift` shows the next set. */
export function tipsNow(n = 3, shift = 0): GuideTip[] {
  const slot = Math.floor((Date.now() - new Date().getTimezoneOffset() * 60000) / 3600000) + shift;
  const a = GUIDE_TIPS.slice();
  let h = (slot * 2654435761 + 17) >>> 0 || 1;
  const rnd = () => { h ^= h << 13; h >>>= 0; h ^= h >>> 17; h ^= h << 5; h >>>= 0; return h / 4294967296; };
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, n);
}
