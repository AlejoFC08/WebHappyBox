const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function entorno() {
    class Elemento {
        constructor() { this.style = {}; this.children = []; this.classList = { toggle() {}, add() {}, remove() {} }; }
        append(...nodes) { this.children.push(...nodes); }
        prepend(node) { this.children.unshift(node); }
        appendChild(node) { this.append(node); }
        replaceChildren(...nodes) { this.children = nodes; }
        setAttribute(key, value) { this[key] = value; }
        addEventListener() {}
    }
    const elements = new Map();
    const get = id => {
        if (!elements.has(id)) elements.set(id, new Elemento());
        return elements.get(id);
    };
    const context = vm.createContext({
        Intl, URL, AbortController, setTimeout, clearTimeout,
        document: { createElement: () => new Elemento(), getElementById: id => id === 'aviso-carrito' ? (elements.get('.pie-carrito')?.children.find(node => node.id === id) || null) : get(id),
            querySelector: selector => selector === '.hero-carrusel' ? null : get(selector), querySelectorAll: () => [] },
        location: { href: 'https://example.com/', hash: '' },
        localStorage: { getItem: () => null, setItem() {} },
        fetch: async () => ({ ok: true, json: async () => [] }),
        alert() {}, window: { open(url) { context.opened = url; } }
    });
    const source = fs.readFileSync(require('node:path').join(__dirname, '../script.js'), 'utf8');
    vm.runInContext(source.slice(0, source.lastIndexOf('cargarCarritoStorage();')), context);
    return { context, run: code => vm.runInContext(code, context), elements };
}

test('IDs sin posición, precios inválidos y duplicados', () => {
    const { run } = entorno();
    assert.equal(run("normalizarProductos([{nombre:'A',precio:100}])[0]._key"), run("normalizarProductos([{nombre:'B',precio:200},{nombre:'A',precio:100}])[1]._key"));
    assert.throws(() => run("normalizarProductos([{nombre:'A',precio:'15.000,50'}])"));
    assert.throws(() => run("normalizarProductos([{id:1,nombre:'A',precio:100},{id:1,nombre:'B',precio:200}])"));
});

test('carrito actualiza precios y elimina productos retirados', () => {
    const { run } = entorno();
    run("productosDisponibles=normalizarProductos([{id:'a',nombre:'Nuevo',precio:200}]); carrito=[{id:'a',nombre:'Viejo',precio:100,cantidad:2},{id:'b',nombre:'Retirado',precio:50,cantidad:1}]; sincronizarCarrito()");
    assert.equal(run('carrito.length'), 1);
    assert.equal(run('carrito[0].precio'), 200);
    assert.equal(run('carrito[0].cantidad'), 2);
});

test('WhatsApp conserva caracteres especiales y bloquea catálogo sin validar', () => {
    const { context, run } = entorno();
    run("carrito=[{id:'a',nombre:'Box & #1 + cariño',precio:15000,cantidad:2}]; enviarPedidoWhatsApp()");
    assert.equal(context.opened, undefined);
    run('catalogoListo=true; enviarPedidoWhatsApp()');
    const message = new URL(context.opened).searchParams.get('text');
    assert.ok(message.includes('Box & #1 + cariño'));
    assert.ok(message.includes('$30.000'));
    assert.ok(message.includes('\n'));
});

test('datos externos se muestran como texto, URLs peligrosas se rechazan', () => {
    const { run } = entorno();
    assert.equal(run("imagenSegura('javascript:alert(1)') === IMAGEN_RESPALDO"), true);
    assert.equal(run("crearTarjetaProducto(normalizarProductos([{id:'a',nombre:'<img onerror=alert(1)>',precio:10}])[0]).children[1].children[0].textContent"), '<img onerror=alert(1)>');
});

test('fallo de carga permite reintentar y luego habilita el pedido', async () => {
    const { context, run, elements } = entorno();
    context.fetch = async () => { throw new Error('offline'); };
    await run('cargarProductos()');
    assert.equal(run('catalogoListo'), false);
    assert.equal(elements.get('contenedor-destacados').children[0].children[1].textContent, 'Reintentar');
    context.fetch = async () => ({ ok: true, json: async () => [{ id: 'a', nombre: 'Box', precio: 100 }] });
    await run('cargarProductos()');
    assert.equal(run('catalogoListo'), true);
    assert.equal(elements.get('.pie-carrito').children.find(node => node.id === 'aviso-carrito').textContent, '');
});

test('papelería agrupa seis agendas y dos cuadernos sin duplicar la agenda anterior', () => {
    const { run } = entorno();
    run("productosDisponibles=integrarPapeleria([{id:'vieja',nombre:'AGENDA 2027',precio:22000},{id:'box',nombre:'Box con agenda',precio:30000}])");
    assert.equal(run('productosDisponibles.length'), 3);
    assert.equal(run("productosDisponibles.find(p=>p.nombre==='Agendas 2027').variantes.length"), 6);
    assert.equal(run("productosDisponibles.find(p=>p.nombre==='Cuadernos A5').variantes.length"), 2);
    assert.equal(run("productosDisponibles.find(p=>p.nombre==='Agendas 2027').precio"), 14000);
    assert.equal(run("productosDisponibles.find(p=>p.nombre==='Cuadernos A5').precio"), 12000);
});

test('se exige modelo y cada variante ocupa su propia línea en el carrito', () => {
    const { run } = entorno();
    run('productosDisponibles=integrarPapeleria([]); catalogoListo=true');
    assert.equal(run("agregarAlCarrito('papeleria-agendas-2027',1)"), false);
    assert.equal(run("agregarAlCarrito('papeleria-agendas-2027',1,'inexistente')"), false);
    run("agregarAlCarrito('papeleria-agendas-2027',2,'luna'); agregarAlCarrito('papeleria-agendas-2027',1,'corazones'); agregarAlCarrito('papeleria-agendas-2027',1,'luna')");
    assert.equal(run('carrito.length'), 2);
    assert.equal(run('carrito[0].cantidad'), 3);
    assert.equal(run('carrito[1].cantidad'), 1);
    assert.notEqual(run('carrito[0].id'), run('carrito[1].id'));
});

test('modelo y foto persisten al recargar y se incluyen en WhatsApp', () => {
    const { context, run } = entorno();
    run("productosDisponibles=integrarPapeleria([]); catalogoListo=true; agregarAlCarrito('papeleria-cuadernos-a5',2,'rosa-lila')");
    const guardado = run('JSON.stringify(carrito)');
    context.localStorage.getItem = () => guardado;
    run('carrito=[]; cargarCarritoStorage(); sincronizarCarrito(); enviarPedidoWhatsApp()');
    assert.equal(run('carrito[0].varianteId'), 'rosa-lila');
    assert.ok(run('carrito[0].imagen').endsWith('cuaderno-rosa-lila-recorte.jpg'));
    const mensaje = new URL(context.opened).searchParams.get('text');
    assert.ok(mensaje.includes('2x Cuadernos A5 — Rosa y lila ($24.000)'));
});

test('sincronización conserva la variante, actualiza precio y retira modelos eliminados', () => {
    const { run } = entorno();
    run("productosDisponibles=integrarPapeleria([]); catalogoListo=true; agregarAlCarrito('papeleria-agendas-2027',1,'luna'); agregarAlCarrito('papeleria-agendas-2027',1,'corazones'); productosDisponibles[0].precio=15000; productosDisponibles[0].variantes=productosDisponibles[0].variantes.filter(v=>v.id!=='corazones'); sincronizarCarrito()");
    assert.equal(run('carrito.length'), 1);
    assert.equal(run('carrito[0].varianteId'), 'luna');
    assert.equal(run('carrito[0].precio'), 15000);
});

test('selector cambia galería y se restablece al abrir otro producto', () => {
    const { run, elements } = entorno();
    run("productosDisponibles=integrarPapeleria([{id:'box',nombre:'Box',precio:100}]); catalogoListo=true; abrirDetalleProducto('papeleria-agendas-2027')");
    assert.equal(elements.get('.btn-agregar-modal').disabled, true);
    run("seleccionarVariante('luna')");
    assert.equal(elements.get('.btn-agregar-modal').disabled, false);
    assert.equal(run('detalleProductoImagenes.length'), 3);
    assert.ok(elements.get('detalle-producto-imagen').src.endsWith('agenda-luna-recorte.jpg'));
    run("abrirDetalleProducto('papeleria-cuadernos-a5')");
    assert.equal(run('detalleVarianteId'), null);
    assert.equal(elements.get('.btn-agregar-modal').disabled, true);
    run("abrirDetalleProducto('box')");
    assert.equal(elements.get('detalle-variantes').hidden, true);
    assert.equal(elements.get('.btn-agregar-modal').disabled, false);
});
