// URL de tu API de Google Apps Script
const API_URL = "https://script.google.com/macros/s/AKfycbyYGk-Me7wbjak3NDBnP06hw3UKftMxU4143nyBKIN5-lsrSYjPw11HBJqKsLMJcsUj/exec";

// Imagen de respaldo temática (caja de regalo) para productos sin foto propia
const IMAGEN_RESPALDO = "data:image/svg+xml;utf8," + encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
  <rect width="200" height="200" fill="#FCFBF9"/>
  <rect x="40" y="90" width="120" height="80" rx="4" fill="#800311"/>
  <rect x="40" y="90" width="120" height="22" fill="#5C020C"/>
  <rect x="92" y="90" width="16" height="80" fill="#C6A664"/>
  <rect x="40" y="112" width="120" height="16" fill="#C6A664"/>
  <path d="M100 90 C80 60, 55 65, 60 85 C65 100, 90 95, 100 90 Z" fill="#C6A664"/>
  <path d="M100 90 C120 60, 145 65, 140 85 C135 100, 110 95, 100 90 Z" fill="#C6A664"/>
</svg>`);

// Categorías del catálogo. Para asignar un producto a una categoría
// agregá una columna "categoria" en el Google Sheet con el texto correspondiente
// ("ramo", "taza", "dulce", "salada"/"salado" o "cumple"). Si la columna no
// existe o no coincide con ninguna, el producto se muestra en "Box Dulces"
// por defecto.
const CATEGORIAS = {
    ramos: { titulo: 'Ramos de Golosinas', contenedorId: 'contenedor-ramos' },
    tazas: { titulo: 'Arreglos de Tazas', contenedorId: 'contenedor-tazas' },
    dulces: { titulo: 'Box Dulces', contenedorId: 'contenedor-dulces' },
    saladas: { titulo: 'Box Saladas', contenedorId: 'contenedor-saladas' },
    cumpleanos: { titulo: 'Cajitas de Cumpleaños', contenedorId: 'contenedor-cumpleanos' },
    especiales: { titulo: 'Regalos Especiales', contenedorId: 'contenedor-especiales' }
};

const CARRITO_STORAGE_KEY = 'happybox-carrito';

let carrito = [];
let productosDisponibles = [];
let catalogoListo = false;
let cargandoCatalogo = false;
const formatoPrecio = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });
const precioTexto = valor => formatoPrecio.format(valor);

function elemento(tag, clase, texto) {
    const el = document.createElement(tag);
    if (clase) el.className = clase;
    if (texto !== undefined) el.textContent = texto;
    return el;
}

function imagenSegura(url) {
    try {
        const parsed = new URL(url, location.href);
        return ['https:', 'http:'].includes(parsed.protocol) ? parsed.href : IMAGEN_RESPALDO;
    } catch {
        return IMAGEN_RESPALDO;
    }
}

function crearImagen(url, nombre, clase) {
    const img = elemento('img', clase);
    img.src = imagenSegura(url);
    img.alt = nombre;
    img.loading = 'lazy';
    img.onerror = () => { img.onerror = null; img.src = IMAGEN_RESPALDO; };
    return img;
}

function normalizarProductos(datos) {
    if (!Array.isArray(datos)) throw new Error('Catálogo inválido');
    const claves = new Set();
    return datos.filter(p => p && typeof p === 'object' && String(p.nombre || '').trim()).map(p => {
        const nombre = String(p.nombre).trim();
        // Sin ID se usa el nombre y categoría, nunca la posición en la planilla.
        const key = String(p.id ?? '').trim() || `nombre:${JSON.stringify([nombre, categoriaDeProducto(p)])}`;
        const precio = typeof p.precio === 'number' ? p.precio :
            (/^\d+(\.\d+)?$/.test(String(p.precio).trim()) ? Number(p.precio) : NaN);
        if (!Number.isFinite(precio) || precio < 0 || claves.has(key)) throw new Error('Precio o ID inválido');
        claves.add(key);
        return { ...p, nombre, precio, _key: key, _imagenes: obtenerImagenesProducto(p).map(imagenSegura) };
    });
}

function sincronizarCarrito() {
    let cambios = false;
    carrito = carrito.flatMap(item => {
        const producto = productosDisponibles.find(p => p._key === item.id);
        if (!producto) { cambios = true; return []; }
        if (item.precio !== producto.precio || item.nombre !== producto.nombre) cambios = true;
        return [{ ...item, nombre: producto.nombre, precio: producto.precio, imagen: producto._imagenes[0] }];
    });
    if (cambios) avisoCarrito('Actualizamos tu pedido con los precios actuales y quitamos los productos que ya no están disponibles. Revisalo antes de enviarlo.');
}

function avisoCarrito(texto) {
    let aviso = document.getElementById('aviso-carrito');
    if (!aviso) {
        aviso = elemento('p', 'aviso-carrito');
        aviso.id = 'aviso-carrito';
        aviso.setAttribute('role', 'status');
        document.querySelector('.pie-carrito').prepend(aviso);
    }
    aviso.textContent = texto;
}

function estadoCatalogo(texto, reintentar = false) {
    [...Object.values(CATEGORIAS).map(c => c.contenedorId), 'contenedor-destacados'].forEach(id => {
        const contenedor = document.getElementById(id);
        if (!contenedor) return;
        const estado = elemento('div', 'categoria-vacia');
        estado.setAttribute('role', 'status');
        estado.append(elemento('p', '', texto));
        if (reintentar) {
            const boton = elemento('button', 'btn-reintentar', 'Reintentar');
            boton.addEventListener('click', cargarProductos);
            estado.append(boton);
        }
        contenedor.replaceChildren(estado);
    });
}
// Producto "extra" (ver categoriaDeProducto) que se ofrece como complemento
// dentro del modal de vista rápida de cualquier otro producto, ej: una rosa
// de plástico para sumar a una box. null si la planilla no tiene ninguno.
let productoExtraRosa = null;

// Convierte un link de Google Drive (el que te da el botón "Compartir") en una
// URL que se puede usar directo en un <img>. Así, en la planilla, en la columna
// "imagen" podés pegar el link de Drive tal cual, sin pasar por postimg ni nada.
// Si el link no es de Drive, lo devuelve sin cambios (sigue funcionando con
// postimg.cc o cualquier otro link de imagen directo).
function normalizarUrlImagen(url) {
    if (!url) return url;
    const texto = url.toString().trim();
    if (!texto.includes('drive.google.com')) return texto;

    const porRuta = texto.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
    const porQuery = texto.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    const id = porRuta ? porRuta[1] : (porQuery ? porQuery[1] : null);

    return id ? `https://lh3.googleusercontent.com/d/${id}` : texto;
}

// Un producto puede tener más de una foto: en la planilla, en la columna
// "imagen", se pueden pegar varios links separados por coma (cada uno puede
// ser de postimg.cc, Google Drive, o lo que sea). Acá los separamos,
// normalizamos cada uno y devolvemos la lista lista para usar.
function obtenerImagenesProducto(producto) {
    const crudo = (producto.imagen || '').toString();
    const partes = crudo.split(',').map(s => s.trim()).filter(Boolean).map(normalizarUrlImagen);
    return partes.length > 0 ? partes : [IMAGEN_RESPALDO];
}

// Nombres de productos/golosinas que la planilla suele escribir de forma
// inconsistente (todo minúscula, sin tildes, etc.). Acá se corrigen a su
// forma "prolija" antes de mostrarlos. Si un ítem no está en esta lista,
// se le aplica una capitalización genérica (ver capitalizarPalabra).
const NOMBRES_CONOCIDOS = {
    'kit kat': 'KitKat',
    'bon o bon': 'Bon o Bon',
    'oblea bon o bon': 'Oblea Bon o Bon',
    'nugaton': 'Nugatón',
    'mani': 'Maní',
    'nuetella': 'Nutella',
    'chocolate cofler': 'Chocolate Cofler',
    'ferrero triple': 'Ferrero Triple',
    'kinder max': 'Kinder Max',
    'kinder barraita': 'Kinder Barrita',
    'mini rocklets': 'Mini Rocklets',
    'rocklets': 'Rocklets',
    'dos corazones': 'Dos Corazones',
    'mogul moritas': 'Mogul Moritas',
    'bolsa premiun': 'Bolsa Premium',
    'queso tybo': 'Queso Tybo',
    'gomitas': 'Gomitas'
};

// Palabras chicas que quedan en minúscula salvo que sean la primera del ítem
const CONECTORES = ['o', 'y', 'de', 'del', 'la', 'el'];

function capitalizarPalabra(palabra, esPrimera) {
    if (!esPrimera && CONECTORES.includes(palabra.toLowerCase())) return palabra.toLowerCase();
    return palabra.charAt(0).toUpperCase() + palabra.slice(1).toLowerCase();
}

function formatearNombreItem(nombre) {
    const clave = nombre.trim().toLowerCase();
    if (NOMBRES_CONOCIDOS[clave]) return NOMBRES_CONOCIDOS[clave];
    return nombre
        .trim()
        .split(/\s+/)
        .map((palabra, i) => {
            const claveLimpia = palabra.replace(/[.,]+$/, '').toLowerCase();
            if (NOMBRES_CONOCIDOS[claveLimpia]) {
                return NOMBRES_CONOCIDOS[claveLimpia] + palabra.slice(claveLimpia.length);
            }
            return capitalizarPalabra(palabra, i === 0);
        })
        .join(' ');
}

// Las descripciones en la planilla vienen con formatos muy distintos: a veces
// separadas por coma, a veces cada ítem en su propia línea (con \n, \r\n o
// mezclando ambos), a veces con tabs entre la cantidad y el nombre, a veces
// todo en mayúsculas. Esta función limpia todo eso y devuelve una lista
// prolija separada por comas. Si el texto es una frase libre (sin comas ni
// saltos de línea, como una descripción tipo "diseño personalizado"), no la
// trata como lista: solo prolija los espacios y la primera letra.
function formatearDescripcion(texto) {
    if (!texto) return '';

    const normalizado = texto.toString().replace(/\r\n/g, '\n').replace(/\n/g, ',');
    const items = normalizado
        .split(',')
        .map(item => item
            .replace(/\t+/g, ' ')
            .replace(/(\d)([A-Za-zÁÉÍÓÚÑáéíóúñ])/g, '$1 $2')
            .replace(/\s+/g, ' ')
            .trim())
        .filter(Boolean);

    if (items.length <= 1) {
        const frase = items[0] || '';
        return frase.charAt(0).toUpperCase() + frase.slice(1);
    }

    return items
        .map(item => {
            const match = item.match(/^(\d+)\s*(.*)$/);
            if (match && match[2]) {
                return `${match[1]} ${formatearNombreItem(match[2])}`;
            }
            return formatearNombreItem(item);
        })
        .join(', ');
}

function categoriaDeProducto(producto) {
    const texto = (producto.categoria || '').toString().trim().toLowerCase();
    if (texto.includes('ramo')) return 'ramos';
    if (texto.includes('taza')) return 'tazas';
    if (texto.includes('salada') || texto.includes('salado')) return 'saladas';
    if (texto.includes('cumple')) return 'cumpleanos';
    if (texto.includes('especial') || texto.includes('maestro')) return 'especiales';
    // "extra": productos que no se muestran como tarjeta en ningún lado (ni
    // catálogo ni destacados), pero sí se pueden ofrecer como complemento
    // dentro del modal de otro producto (ver productoExtraRosa).
    if (texto.includes('extra') || texto.includes('complemento')) return 'extra';
    if (texto.includes('dulce')) return 'dulces';
    return 'dulces';
}

// Guardar/recuperar el carrito en localStorage para que no se pierda al cambiar de página
function guardarCarritoStorage() {
    try {
        localStorage.setItem(CARRITO_STORAGE_KEY, JSON.stringify(carrito));
    } catch (error) {
        // Si el navegador bloquea localStorage (modo privado, etc.) seguimos sin persistencia
    }
}

function cargarCarritoStorage() {
    try {
        const guardado = localStorage.getItem(CARRITO_STORAGE_KEY);
        const datos = guardado ? JSON.parse(guardado) : [];
        carrito = Array.isArray(datos) ? datos.filter(item => item && typeof item.id === 'string' &&
            typeof item.nombre === 'string' && item.precio !== '' && Number.isFinite(Number(item.precio)) && Number(item.precio) >= 0 &&
            Number.isSafeInteger(item.cantidad) && item.cantidad > 0).map(item => ({ ...item, precio: Number(item.precio) })) : [];
    } catch (error) {
        carrito = [];
    }
}

// Si se entra a la página con un ancla (ej: productos.html#cat-ramos, como
// hacen las tiles de categoría de la home), el navegador intenta saltar ahí
// apenas carga el HTML, pero en ese momento los productos todavía no llegaron
// del Google Sheet y la página es mucho más corta. Cuando el catálogo termina
// de renderizarse (y la página ya tiene su alto final) volvemos a saltar al
// ancla para que quede bien posicionada.
function saltarAAnclaSiCorresponde() {
    if (!location.hash) return;
    let id;
    try { id = decodeURIComponent(location.hash.slice(1)); } catch { return; }
    const el = document.getElementById(id);
    if (el) {
        el.scrollIntoView();
    }
}

// Cargar productos desde Google Sheets
async function cargarProductos() {
    if (cargandoCatalogo) return;
    cargandoCatalogo = true;
    catalogoListo = false;
    actualizarInterfazCarrito();
    estadoCatalogo('Cargando productos…');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
        const respuesta = await fetch(API_URL, { signal: controller.signal, cache: 'no-store' });
        if (!respuesta.ok) throw new Error('No se pudo cargar el catálogo');
        const productos = normalizarProductos(await respuesta.json());
        productosDisponibles = productos;
        avisoCarrito('');
        sincronizarCarrito();
        catalogoListo = true;
        productoExtraRosa = productos.find(p => categoriaDeProducto(p) === 'extra') || null;
        mostrarCatalogoPorCategorias(productos);
        mostrarDestacados(productos);
        if (!productos.some(p => categoriaDeProducto(p) !== 'extra')) {
            estadoCatalogo('Todavía no hay productos disponibles. Consultanos por WhatsApp.');
        }
        saltarAAnclaSiCorresponde();
    } catch (error) {
        estadoCatalogo('No pudimos cargar los productos. Intentá nuevamente.', true);
        avisoCarrito('Necesitamos cargar el catálogo para confirmar los precios de tu pedido.');
    } finally {
        clearTimeout(timeout);
        cargandoCatalogo = false;
        actualizarInterfazCarrito();
    }
}

// Home: mostrar unos pocos productos destacados (los primeros con nombre)
const CANTIDAD_DESTACADOS = 4;

function mostrarDestacados(productos) {
    const contenedor = document.getElementById('contenedor-destacados');
    if (!contenedor) return;

    contenedor.innerHTML = '';
    let mostrados = 0;

    productos.forEach(producto => {
        if (mostrados >= CANTIDAD_DESTACADOS || !producto.nombre) return;
        if (categoriaDeProducto(producto) === 'extra') return; // no es un producto destacable

        const tarjeta = crearTarjetaProducto(producto);
        tarjeta.classList.add('destacado-tarjeta');
        contenedor.appendChild(tarjeta);
        mostrados += 1;
    });
}

// CARRUSEL DEL HERO (home)
let heroSlideActual = 0;

function mostrarSlideHero(indice) {
    const slides = document.querySelectorAll('.hero-slide');
    const puntos = document.querySelectorAll('.hero-punto');
    if (slides.length === 0) return;

    heroSlideActual = (indice + slides.length) % slides.length;

    slides.forEach((slide, i) => slide.classList.toggle('hero-slide-activo', i === heroSlideActual));
    puntos.forEach((punto, i) => punto.classList.toggle('hero-punto-activo', i === heroSlideActual));
}

function cambiarSlideHero(delta) {
    mostrarSlideHero(heroSlideActual + delta);
}

function irASlideHero(indice) {
    mostrarSlideHero(indice);
}

if (document.querySelector('.hero-carrusel')) {
    setInterval(() => cambiarSlideHero(1), 6000);
}

// Renderizar cada producto en la sección de su categoría correspondiente
function mostrarCatalogoPorCategorias(productos) {
    const contenedores = {};
    let hayContenedores = false;

    Object.keys(CATEGORIAS).forEach(clave => {
        const el = document.getElementById(CATEGORIAS[clave].contenedorId);
        contenedores[clave] = el;
        if (el) {
            hayContenedores = true;
            el.innerHTML = '';
        }
    });

    if (!hayContenedores) return; // Esta página no tiene catálogo (ej: la home)

    const conteo = { ramos: 0, tazas: 0, dulces: 0, saladas: 0, cumpleanos: 0, especiales: 0 };

    productos.forEach(producto => {
        if (!producto.nombre) return;

        const clave = categoriaDeProducto(producto);
        const contenedor = contenedores[clave];
        if (!contenedor) return;

        conteo[clave] += 1;
        contenedor.appendChild(crearTarjetaProducto(producto));
    });

    Object.keys(CATEGORIAS).forEach(clave => {
        const contenedor = contenedores[clave];
        if (contenedor && conteo[clave] === 0) {
            contenedor.innerHTML = `<p class="categoria-vacia">Muy pronto vas a encontrar acá nuestros ${CATEGORIAS[clave].titulo.toLowerCase()}. ¡Estamos preparando todo!</p>`;
        }
    });
}

// Arma la tarjeta de producto (foto + cartel con nombre y precio) que se usa
// tanto en "Destacados" del home como en el catálogo. La descripción completa
// se ve en la vista rápida al tocar la tarjeta, no en la tarjeta misma.
function crearTarjetaProducto(producto) {
    const tarjeta = document.createElement('div');
    tarjeta.className = 'tarjeta-producto';

    const banner = elemento('div', 'producto-banner');
    banner.append(elemento('h3', '', producto.nombre), elemento('span', 'producto-precio', `$${precioTexto(producto.precio)}`));
    tarjeta.append(crearImagen(producto._imagenes[0], producto.nombre), banner);
    tarjeta.tabIndex = 0;
    tarjeta.setAttribute('role', 'button');
    tarjeta.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            abrirDetalleProducto(producto._key);
        }
    });
    tarjeta.addEventListener('click', () => abrirDetalleProducto(producto._key));
    return tarjeta;
}

// Agregar ítems al carrito (busca los datos completos del producto por su clave)
function agregarAlCarrito(key, cantidad = 1) {
    const producto = productosDisponibles.find(p => String(p._key) === String(key));
    if (!producto || !catalogoListo || !Number.isSafeInteger(cantidad) || cantidad < 1) return;

    const itemExistente = carrito.find(item => String(item.id) === String(key));

    if (itemExistente) {
        itemExistente.cantidad += cantidad;
    } else {
        carrito.push({
            id: String(key),
            nombre: producto.nombre,
            precio: producto.precio,
            imagen: producto._imagenes ? producto._imagenes[0] : IMAGEN_RESPALDO,
            cantidad: cantidad
        });
    }
    actualizarInterfazCarrito();
}

// MODAL DE DETALLE DE PRODUCTO (vista rápida antes de agregar al carrito)
let detalleProductoKey = null;
let detalleProductoCantidad = 1;
let detalleProductoImagenes = [];
let detalleProductoImagenIndice = 0;

function abrirDetalleProducto(key) {
    const producto = productosDisponibles.find(p => String(p._key) === String(key));
    if (!producto) return;

    detalleProductoKey = key;
    detalleProductoCantidad = 1;
    detalleProductoImagenes = producto._imagenes && producto._imagenes.length > 0 ? producto._imagenes : [IMAGEN_RESPALDO];
    detalleProductoImagenIndice = 0;

    document.getElementById('detalle-producto-nombre').innerText = producto.nombre;
    mostrarImagenModal();
    document.getElementById('detalle-producto-descripcion').innerText = formatearDescripcion(producto.descripcion);
    document.getElementById('detalle-producto-precio').innerText = precioTexto(producto.precio);
    document.getElementById('detalle-producto-cantidad').innerText = detalleProductoCantidad;

    mostrarExtraRosaSiCorresponde(producto);

    document.getElementById('panel-producto-overlay').classList.add('panel-visible');
}

// Muestra el check "Sumar una rosa de plástico" en el modal de cualquier
// producto que NO sea la rosa misma (evita ofrecerle la rosa a la propia
// rosa). Si la planilla no tiene ningún producto "extra" cargado, la fila
// queda oculta y no rompe nada.
function mostrarExtraRosaSiCorresponde(producto) {
    const fila = document.getElementById('detalle-producto-extra-rosa');
    if (!fila) return;

    const checkRosa = document.getElementById('check-agregar-rosa');
    checkRosa.checked = false;

    const corresponde = productoExtraRosa && String(producto._key) !== String(productoExtraRosa._key);
    fila.style.display = corresponde ? 'flex' : 'none';
    if (!corresponde) return;

    document.getElementById('extra-rosa-nombre').innerText = productoExtraRosa.nombre;
    document.getElementById('extra-rosa-precio').innerText = precioTexto(productoExtraRosa.precio);
    const imgRosa = document.getElementById('extra-rosa-imagen');
    imgRosa.src = productoExtraRosa._imagenes ? productoExtraRosa._imagenes[0] : IMAGEN_RESPALDO;
    imgRosa.alt = productoExtraRosa.nombre;
}

// La miniatura del complemento es chica a propósito (no es el producto
// principal del modal), así que se puede tocar para verla más grande en un
// lightbox simple. preventDefault/stopPropagation evitan que el toque
// también tilde el checkbox (la miniatura está dentro del <label>).
function abrirLightboxExtra(event) {
    event.preventDefault();
    event.stopPropagation();
    if (!productoExtraRosa) return;

    document.getElementById('lightbox-extra-imagen').src = productoExtraRosa._imagenes
        ? productoExtraRosa._imagenes[0]
        : IMAGEN_RESPALDO;
    document.getElementById('lightbox-extra-imagen').alt = productoExtraRosa.nombre;
    document.getElementById('lightbox-extra').classList.add('lightbox-visible');
}

function cerrarLightboxExtra() {
    document.getElementById('lightbox-extra').classList.remove('lightbox-visible');
}

// Pinta la foto actual de la galería del modal, junto con las flechas y los
// puntos (que solo se muestran si el producto tiene más de una foto)
function mostrarImagenModal() {
    const nombre = document.getElementById('detalle-producto-nombre').innerText;
    const imagen = document.getElementById('detalle-producto-imagen');
    imagen.src = detalleProductoImagenes[detalleProductoImagenIndice];
    imagen.alt = nombre;
    imagen.onerror = () => { imagen.onerror = null; imagen.src = IMAGEN_RESPALDO; };

    const hayVarias = detalleProductoImagenes.length > 1;
    const controles = document.querySelectorAll('.detalle-imagen-flecha');
    controles.forEach(c => c.style.display = hayVarias ? 'flex' : 'none');

    const puntosContenedor = document.getElementById('detalle-imagen-puntos');
    if (!hayVarias) {
        puntosContenedor.innerHTML = '';
        return;
    }
    puntosContenedor.innerHTML = detalleProductoImagenes
        .map((_, i) => `<button class="detalle-imagen-punto${i === detalleProductoImagenIndice ? ' detalle-imagen-punto-activo' : ''}" onclick="irAImagenModal(${i})" aria-label="Ver foto ${i + 1}"></button>`)
        .join('');
}

function cambiarImagenModal(delta) {
    const total = detalleProductoImagenes.length;
    detalleProductoImagenIndice = (detalleProductoImagenIndice + delta + total) % total;
    mostrarImagenModal();
}

function irAImagenModal(indice) {
    detalleProductoImagenIndice = indice;
    mostrarImagenModal();
}

function cerrarDetalleProducto() {
    document.getElementById('panel-producto-overlay').classList.remove('panel-visible');
}

function cambiarCantidadModal(delta) {
    detalleProductoCantidad = Math.max(1, detalleProductoCantidad + delta);
    document.getElementById('detalle-producto-cantidad').innerText = detalleProductoCantidad;
}

function confirmarAgregarDesdeModal() {
    if (!detalleProductoKey) return;
    agregarAlCarrito(detalleProductoKey, detalleProductoCantidad);

    const checkRosa = document.getElementById('check-agregar-rosa');
    if (checkRosa && checkRosa.checked && productoExtraRosa) {
        agregarAlCarrito(productoExtraRosa._key, 1);
    }

    cerrarDetalleProducto();
}

// Cerrar la vista rápida si se hace clic fuera de la ventana blanca
const overlayProducto = document.getElementById('panel-producto-overlay');
if (overlayProducto) {
    overlayProducto.addEventListener('click', function(e) {
        if (e.target === this) {
            cerrarDetalleProducto();
        }
    });
}

// Sumar o restar una unidad de un ítem ya presente en el carrito
function cambiarCantidad(id, delta) {
    const item = carrito.find(item => String(item.id) === String(id));
    if (!item) return;

    item.cantidad += delta;
    if (item.cantidad <= 0) {
        carrito = carrito.filter(item => String(item.id) !== String(id));
    }
    actualizarInterfazCarrito();
}

// Quitar un ítem completo del carrito
function quitarDelCarrito(id) {
    carrito = carrito.filter(item => String(item.id) !== String(id));
    actualizarInterfazCarrito();
}

// Vaciar el carrito por completo
function vaciarCarrito() {
    if (carrito.length === 0) return;
    if (confirm("¿Vaciar todo el carrito?")) {
        carrito = [];
        actualizarInterfazCarrito();
    }
}

// Actualizar el panel del carrito y el contador de cabecera
function actualizarInterfazCarrito() {
    const lista = document.getElementById('lista-carrito');
    const totalSpan = document.getElementById('total-precio');
    const contadorCabecera = document.getElementById('contador-carrito');
    const btnVaciar = document.querySelector('.btn-vaciar');

    btnVaciar.style.visibility = carrito.length === 0 ? 'hidden' : 'visible';
    lista.innerHTML = '';
    let total = 0;
    let totalProductos = 0;

    if (carrito.length === 0) {
        lista.innerHTML = `
            <div class="carrito-vacio">
                <svg class="carrito-vacio-icono" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M6 8h12l-1 12a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1L6 8Z"/>
                    <path d="M9 8V6.5a3 3 0 0 1 6 0V8"/>
                </svg>
                <p>Tu carrito está vacío.</p>
                <p class="carrito-vacio-sub">Agregá alguna HappyBox del catálogo para empezar tu pedido.</p>
            </div>
        `;
    } else {
        carrito.forEach(item => {
            const subtotal = item.precio * item.cantidad;
            total += subtotal;
            totalProductos += item.cantidad;

            const fila = elemento('div', 'item-carrito');
            const info = elemento('div', 'item-info');
            info.append(elemento('span', 'item-nombre', item.nombre),
                elemento('span', 'item-precio-unitario', '$' + precioTexto(item.precio) + ' c/u'));
            const controles = elemento('div', 'item-cantidad-controles');
            const restar = elemento('button', 'btn-cantidad', '−');
            restar.setAttribute('aria-label', 'Restar uno');
            restar.addEventListener('click', () => cambiarCantidad(item.id, -1));
            const sumar = elemento('button', 'btn-cantidad', '+');
            sumar.setAttribute('aria-label', 'Sumar uno');
            sumar.addEventListener('click', () => cambiarCantidad(item.id, 1));
            controles.append(restar, elemento('span', 'item-cantidad', item.cantidad), sumar);
            const quitar = elemento('button', 'btn-quitar', '🗑');
            quitar.setAttribute('aria-label', 'Quitar ' + item.nombre + ' del carrito');
            quitar.addEventListener('click', () => quitarDelCarrito(item.id));
            fila.append(crearImagen(item.imagen, item.nombre, 'item-imagen'), info, controles,
                elemento('span', 'item-subtotal', '$' + precioTexto(subtotal)), quitar);
            lista.append(fila);
        });
    }

    totalSpan.innerText = precioTexto(total);
    const finalizar = document.querySelector(".btn-whatsapp");
    finalizar.disabled = !catalogoListo || carrito.length === 0;
    contadorCabecera.innerText = totalProductos; // Actualiza el botón de la cabecera
    contadorCabecera.classList.toggle('badge-oculta', totalProductos === 0);
    guardarCarritoStorage();
}

// LÓGICA DE LA VENTANA SEPARADA (MODAL)

function abrirCarrito() {
    const overlay = document.getElementById('panel-carrito-overlay');
    overlay.classList.add('panel-visible'); // Muestra la ventana separada
}

function cerrarCarrito() {
    const overlay = document.getElementById('panel-carrito-overlay');
    overlay.classList.remove('panel-visible'); // Oculta la ventana separada
}

// Cerrar el carrito si se hace clic FUERA de la ventana modal blanca
document.getElementById('panel-carrito-overlay').addEventListener('click', function(e) {
    if (e.target === this) {
        cerrarCarrito();
    }
});

// Menú hamburguesa (solo visible en mobile): despliega/oculta los links de
// navegación, que en celu aparecen como un panel debajo de la cabecera fija.
function alternarMenuMobile() {
    const nav = document.getElementById('navegacion-principal');
    const boton = document.getElementById('boton-menu');
    const abierto = nav.classList.toggle('navegacion-abierta');
    boton.setAttribute('aria-expanded', abierto ? 'true' : 'false');
}

// Al tocar un link del menú (aunque sea un ancla a la misma página), se cierra
// el panel para no dejarlo tapando el contenido.
document.querySelectorAll('#navegacion-principal a').forEach(function(link) {
    link.addEventListener('click', function() {
        document.getElementById('navegacion-principal').classList.remove('navegacion-abierta');
        document.getElementById('boton-menu').setAttribute('aria-expanded', 'false');
    });
});

// Enviar el pedido formateado a WhatsApp
function enviarPedidoWhatsApp() {
    if (!catalogoListo) {
        avisoCarrito('Cargá el catálogo para confirmar los precios antes de enviar el pedido.');
        return;
    }
    if (carrito.length === 0) {
        alert("Tenés que agregar al menos una HappyBox al carrito.");
        return;
    }

    const numeroDestino = "5491125329776"; // WhatsApp de HappyBox (11 2532-9776)

    // Texto del mensaje (con 'HappyBox')
    let mensaje = "¡Hola HappyBox! 🎁\nQuiero hacer este pedido:\n\n";
    let total = 0;

    carrito.forEach(item => {
        mensaje += `- ${item.cantidad}x ${item.nombre} ($${precioTexto(item.precio * item.cantidad)})\n`;
        total += item.precio * item.cantidad;
    });

    mensaje += `\n*Total de productos: $${precioTexto(total)}*\nEnvío a coordinar.\n\n¡Muchas gracias!`;

    const urlWA = `https://wa.me/${numeroDestino}?text=${encodeURIComponent(mensaje)}`;
    window.open(urlWA, '_blank', 'noopener,noreferrer');
}

// Inicializar: primero se recupera el carrito guardado, después se pinta la
// interfaz y, si la página tiene catálogo, se cargan los productos.
cargarCarritoStorage();
actualizarInterfazCarrito();
if (document.getElementById('contenedor-ramos') || document.getElementById('contenedor-destacados')) {
    cargarProductos();
}
