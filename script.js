// URL de tu API de Google Apps Script
const API_URL = "https://script.google.com/macros/s/AKfycbyYGk-Me7wbjak3NDBnP06hw3UKftMxU4143nyBKIN5-lsrSYjPw11HBJqKsLMJcsUj/exec";

const CLAVE_CARRITO = 'happybox_carrito';

let carrito = cargarCarritoGuardado();
let productosDisponibles = [];

// Recuperar el carrito guardado en el navegador (si existe)
function cargarCarritoGuardado() {
    try {
        const guardado = localStorage.getItem(CLAVE_CARRITO);
        return guardado ? JSON.parse(guardado) : [];
    } catch (error) {
        return [];
    }
}

// Persistir el carrito en el navegador
function guardarCarrito() {
    localStorage.setItem(CLAVE_CARRITO, JSON.stringify(carrito));
}

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
            
            const imagenSrc = producto.imagen ? producto.imagen : 'https://cdn-icons-png.flaticon.com/512/3014/3014457.png';

            tarjeta.innerHTML = `
                <img src="${imagenSrc}" alt="${producto.nombre}">
                <h3>${producto.nombre}</h3>
                <p>${producto.descripcion}</p>
                <div class="precio">$${producto.precio}</div>
                <button onclick="agregarAlCarrito('${producto.id}', '${producto.nombre}', ${producto.precio})">
                    Agregar al carrito
                </button>
            `;
            contenedor.appendChild(tarjeta);
        }
    });
}

// Agregar ítems al carrito
function agregarAlCarrito(id, nombre, precio) {
    const itemExistente = carrito.find(item => item.id === id);

    if (itemExistente) {
        itemExistente.cantidad += 1;
    } else {
        carrito.push({ id, nombre, precio, cantidad: 1 });
    }
    actualizarInterfazCarrito();
}

// Sumar una unidad a un ítem ya agregado
function incrementarCantidad(id) {
    const item = carrito.find(item => item.id === id);
    if (item) {
        item.cantidad += 1;
        actualizarInterfazCarrito();
    }
}

// Restar una unidad; si llega a 0, se quita del carrito
function decrementarCantidad(id) {
    const item = carrito.find(item => item.id === id);
    if (!item) return;

    item.cantidad -= 1;
    if (item.cantidad <= 0) {
        eliminarDelCarrito(id);
    } else {
        actualizarInterfazCarrito();
    }
}

// Quitar un producto del carrito por completo
function eliminarDelCarrito(id) {
    carrito = carrito.filter(item => item.id !== id);
    actualizarInterfazCarrito();
}

// Vaciar todo el carrito
function vaciarCarrito() {
    if (carrito.length === 0) return;
    if (confirm('¿Vaciar todo el carrito?')) {
        carrito = [];
        actualizarInterfazCarrito();
    }
}

// Actualizar el panel del carrito y el contador de cabecera
function actualizarInterfazCarrito() {
    const lista = document.getElementById('lista-carrito');
    const totalSpan = document.getElementById('total-precio');
    const contadorCabecera = document.getElementById('contador-carrito');
    const btnVaciar = document.getElementById('btn-vaciar-carrito');

    lista.innerHTML = '';
    let total = 0;
    let totalProductos = 0;

    if (carrito.length === 0) {
        lista.innerHTML = '<p>El carrito está vacío.</p>';
    } else {
        carrito.forEach(item => {
            const subtotal = item.precio * item.cantidad;
            total += subtotal;
            totalProductos += item.cantidad;

            lista.innerHTML += `
                <div class="item-carrito">
                    <div class="item-info">
                        <span class="item-nombre">${item.nombre}</span>
                        <span class="item-subtotal">$${subtotal}</span>
                    </div>
                    <div class="item-controles">
                        <button class="btn-cantidad" onclick="decrementarCantidad('${item.id}')" aria-label="Restar unidad">−</button>
                        <span class="cantidad-numero">${item.cantidad}</span>
                        <button class="btn-cantidad" onclick="incrementarCantidad('${item.id}')" aria-label="Sumar unidad">+</button>
                        <button class="btn-eliminar" onclick="eliminarDelCarrito('${item.id}')" aria-label="Quitar producto">🗑</button>
                    </div>
                </div>
            `;
        });
    }

    totalSpan.innerText = total;
    contadorCabecera.innerText = totalProductos; // Actualiza el botón de la cabecera
    btnVaciar.style.display = carrito.length === 0 ? 'none' : 'block';

    guardarCarrito();
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
actualizarInterfazCarrito(); // Refleja el carrito guardado (si había uno) apenas carga la página