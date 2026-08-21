// URL de tu API de Google Apps Script
const API_URL = "https://script.google.com/macros/s/AKfycbyYGk-Me7wbjak3NDBnP06hw3UKftMxU4143nyBKIN5-lsrSYjPw11HBJqKsLMJcsUj/exec";

// Imagen de respaldo temática (caja de regalo) para productos sin foto propia
const IMAGEN_RESPALDO = "data:image/svg+xml;utf8," + encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
  <rect width="200" height="200" fill="#FCFBF9"/>
  <rect x="40" y="90" width="120" height="80" rx="4" fill="#1C2836"/>
  <rect x="40" y="90" width="120" height="22" fill="#161f29"/>
  <rect x="92" y="90" width="16" height="80" fill="#C6A664"/>
  <rect x="40" y="112" width="120" height="16" fill="#C6A664"/>
  <path d="M100 90 C80 60, 55 65, 60 85 C65 100, 90 95, 100 90 Z" fill="#C6A664"/>
  <path d="M100 90 C120 60, 145 65, 140 85 C135 100, 110 95, 100 90 Z" fill="#C6A664"/>
</svg>`);

let carrito = [];
let productosDisponibles = [];

// Cargar productos desde Google Sheets
async function cargarProductos() {
    try {
        const respuesta = await fetch(API_URL);
        const productos = await respuesta.json();
        productosDisponibles = productos;
        mostrarProductos(productos);
    } catch (error) {
        document.getElementById('contenedor-productos').innerHTML = '<p>Error al cargar los productos. Intentá refrescar la página.</p>';
    }
}

// Renderizar tarjetas en pantalla
function mostrarProductos(productos) {
    const contenedor = document.getElementById('contenedor-productos');
    contenedor.innerHTML = '';

    productos.forEach(producto => {
        if(producto.nombre) {
            const tarjeta = document.createElement('div');
            tarjeta.className = 'tarjeta-producto';

            const imagenSrc = producto.imagen ? producto.imagen : IMAGEN_RESPALDO;

            tarjeta.innerHTML = `
                <img src="${imagenSrc}" alt="${producto.nombre}" onerror="this.onerror=null;this.src='${IMAGEN_RESPALDO}';">
                <h3>${producto.nombre}</h3>
                <p>${producto.descripcion}</p>
                <div class="precio">$${producto.precio}</div>
                <button onclick="agregarAlCarrito('${producto.id}')">
                    Agregar al carrito
                </button>
            `;
            contenedor.appendChild(tarjeta);
        }
    });
}

// Agregar ítems al carrito (busca los datos completos del producto por id)
// Los id se comparan como string porque el atributo onclick siempre los pasa como texto,
// aunque en la planilla de Google Sheets puedan venir como número.
function agregarAlCarrito(id) {
    const producto = productosDisponibles.find(p => String(p.id) === String(id));
    if (!producto) return;

    const itemExistente = carrito.find(item => String(item.id) === String(id));

    if (itemExistente) {
        itemExistente.cantidad += 1;
    } else {
        carrito.push({
            id: String(id),
            nombre: producto.nombre,
            precio: producto.precio,
            imagen: producto.imagen || IMAGEN_RESPALDO,
            cantidad: 1
        });
    }
    actualizarInterfazCarrito();
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
                <span class="carrito-vacio-icono">🛒</span>
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

    // *** COLOCÁ ACÁ TU NÚMERO DE WHATSAPP ***
    // Ejemplo: "54911XXXXXXXX" (Código de país + área + número sin el 15)
    const numeroDestino = "5491100000000"; 
    
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

// Inicializar la carga al abrir la web
cargarProductos();
actualizarInterfazCarrito();