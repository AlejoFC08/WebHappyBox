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
    cumpleanos: { titulo: 'Cajitas de Cumpleaños', contenedorId: 'contenedor-cumpleanos' }
};

const CARRITO_STORAGE_KEY = 'happybox-carrito';

let carrito = [];
let productosDisponibles = [];

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
        carrito = guardado ? JSON.parse(guardado) : [];
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
    const el = document.querySelector(location.hash);
    if (el) {
        el.scrollIntoView();
    }
}

// Cargar productos desde Google Sheets
async function cargarProductos() {
    try {
        const respuesta = await fetch(API_URL);
        const productos = await respuesta.json();
        productos.forEach(producto => {
            producto._imagenes = obtenerImagenesProducto(producto);
        });
        productosDisponibles = productos;
        mostrarCatalogoPorCategorias(productos);
        mostrarDestacados(productos);
        saltarAAnclaSiCorresponde();
    } catch (error) {
        Object.values(CATEGORIAS).forEach(cat => {
            const contenedor = document.getElementById(cat.contenedorId);
            if (contenedor) {
                contenedor.innerHTML = '<p class="categoria-vacia">Error al cargar los productos. Intentá refrescar la página.</p>';
            }
        });
    }
}

// Home: mostrar unos pocos productos destacados (los primeros con nombre)
const CANTIDAD_DESTACADOS = 4;

function mostrarDestacados(productos) {
    const contenedor = document.getElementById('contenedor-destacados');
    if (!contenedor) return;

    contenedor.innerHTML = '';
    let mostrados = 0;

    productos.forEach((producto, indice) => {
        if (mostrados >= CANTIDAD_DESTACADOS || !producto.nombre) return;

        producto._key = (producto.id !== undefined && producto.id !== null && producto.id !== '')
            ? String(producto.id)
            : 'idx' + indice;

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

    const conteo = { ramos: 0, tazas: 0, dulces: 0, saladas: 0, cumpleanos: 0 };

    productos.forEach((producto, indice) => {
        if (!producto.nombre) return;

        // La planilla suele traer id vacío en varias filas: generamos una clave
        // única y estable por producto para que "Agregar al carrito" nunca
        // confunda un producto con otro.
        producto._key = (producto.id !== undefined && producto.id !== null && producto.id !== '')
            ? String(producto.id)
            : 'idx' + indice;

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

    const imagenSrc = producto._imagenes ? producto._imagenes[0] : IMAGEN_RESPALDO;

    tarjeta.innerHTML = `
        <img src="${imagenSrc}" alt="${producto.nombre}" onerror="this.onerror=null;this.src='${IMAGEN_RESPALDO}';">
        <div class="producto-banner">
            <h3>${producto.nombre}</h3>
            <span class="producto-precio">$${producto.precio}</span>
        </div>
    `;
    tarjeta.addEventListener('click', () => abrirDetalleProducto(producto._key));
    return tarjeta;
}

// Agregar ítems al carrito (busca los datos completos del producto por su clave)
function agregarAlCarrito(key, cantidad = 1) {
    const producto = productosDisponibles.find(p => String(p._key) === String(key));
    if (!producto) return;

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

    mostrarImagenModal();

    document.getElementById('detalle-producto-nombre').innerText = producto.nombre;
    document.getElementById('detalle-producto-descripcion').innerText = formatearDescripcion(producto.descripcion);
    document.getElementById('detalle-producto-precio').innerText = producto.precio;
    document.getElementById('detalle-producto-cantidad').innerText = detalleProductoCantidad;

    document.getElementById('panel-producto-overlay').classList.add('panel-visible');
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

            lista.innerHTML += `
                <div class="item-carrito">
                    <img class="item-imagen" src="${item.imagen}" alt="${item.nombre}">
                    <div class="item-info">
                        <span class="item-nombre">${item.nombre}</span>
                        <span class="item-precio-unitario">$${item.precio} c/u</span>
                    </div>
                    <div class="item-cantidad-controles">
                        <button class="btn-cantidad" onclick="cambiarCantidad('${item.id}', -1)" aria-label="Restar uno">−</button>
                        <span class="item-cantidad">${item.cantidad}</span>
                        <button class="btn-cantidad" onclick="cambiarCantidad('${item.id}', 1)" aria-label="Sumar uno">+</button>
                    </div>
                    <span class="item-subtotal">$${subtotal}</span>
                    <button class="btn-quitar" onclick="quitarDelCarrito('${item.id}')" aria-label="Quitar del carrito">🗑</button>
                </div>
            `;
        });
    }

    totalSpan.innerText = total;
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

// Enviar el pedido formateado a WhatsApp
function enviarPedidoWhatsApp() {
    if (carrito.length === 0) {
        alert("Tenés que agregar al menos una HappyBox al carrito.");
        return;
    }

    const numeroDestino = "5491125329776"; // WhatsApp de HappyBox (11 2532-9776)

    // Texto del mensaje (con 'HappyBox')
    let mensaje = "¡Hola HappyBox! 🎁%0AQuiero hacer este pedido:%0A%0A";
    let total = 0;

    carrito.forEach(item => {
        mensaje += `- ${item.cantidad}x ${item.nombre} ($${item.precio * item.cantidad})%0A`;
        total += item.precio * item.cantidad;
    });

    mensaje += `%0A*Total: $${total}*%0A%0A¡Muchas gracias!`;

    const urlWA = `https://wa.me/${numeroDestino}?text=${mensaje}`;
    window.open(urlWA, '_blank');
}

// Inicializar: primero se recupera el carrito guardado, después se pinta la
// interfaz y, si la página tiene catálogo, se cargan los productos.
cargarCarritoStorage();
actualizarInterfazCarrito();
if (document.getElementById('contenedor-ramos') || document.getElementById('contenedor-destacados')) {
    cargarProductos();
}
