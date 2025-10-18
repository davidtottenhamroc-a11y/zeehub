const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs'); 

const app = express();

// --- Configurações Iniciais ---
app.use(cors());
app.use(express.json());

const MONGODB_URI = process.env.MONGO_URI || "mongodb+srv://davidtottenhamroc_db_user:david0724@cluster0.q29vt6z.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0"; 

// --- Schemas do Sistema de Ponto da Zee Imobiliária ---

const funcionarioSchema = new mongoose.Schema({
    nome: { type: String, required: true },
    email: { type: String, unique: true, sparse: true }, 
    senha: { type: String }, 
    cargo: { type: String, required: true },
    isUser: { type: Boolean, default: false }, 
    permissao: { 
        type: String, 
        enum: ['ponto', 'funcionario', 'gestor', 'admin'], 
        default: 'ponto' 
    },
    createdAt: { type: Date, default: Date.now },
}, { collection: 'funcionarios' });

// Pré-save hook para HASHEAR a senha
funcionarioSchema.pre('save', async function(next) {
    if (this.isUser && this.isModified('senha') && this.senha) {
        const salt = await bcrypt.genSalt(10);
        this.senha = await bcrypt.hash(this.senha, salt);
    }
    next();
});

const Funcionario = mongoose.models.Funcionario || mongoose.model('Funcionario', funcionarioSchema);

const pontoSchema = new mongoose.Schema({
    funcionario: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Funcionario', 
        required: true 
    },
    tipo: { 
        type: String, 
        enum: ['checkin', 'pausa', 'retorno', 'checkout'], 
        required: true 
    },
    dataHora: { 
        type: Date, 
        default: Date.now,
        required: true
    },
    observacao: { type: String }
}, { collection: 'pontos' });

const Ponto = mongoose.models.Ponto || mongoose.model('Ponto', pontoSchema);


// --- FUNÇÃO DE CONEXÃO E INICIALIZAÇÃO ---

if (!MONGODB_URI) {
    console.error('ERRO: Variável MONGO_URI não definida.');
} else {
    mongoose.connect(MONGODB_URI)
        .then(() => {
            console.log('Conexão estabelecida com MongoDB Atlas!');
        })
        .catch(err => {
            console.error('Erro FATAL de conexão com o MongoDB:', err.message);
        });
}


// ------------------------------------
// --- Rotas da API Zee Imobiliária ---
// ------------------------------------

// Rota de Teste
app.get('/', (req, res) => {
    res.status(200).send('API de Gestão de Tempo da Zee Imobiliária Rodando.');
});


// Rota para verificar se existe um Administrador (Usada pelo Front-end para desbloquear o cadastro)
app.get('/api/admin/check-initial', async (req, res) => {
    try {
        const adminCount = await Funcionario.countDocuments({ isUser: true, permissao: 'admin' });
        res.json({ hasAdmin: adminCount > 0 });
    } catch (error) {
        console.error('Erro ao verificar admins:', error);
        res.status(500).json({ message: 'Erro ao verificar administradores.' });
    }
});


// Rota para autenticação (Login) - Mantida para verificar E-mail
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, senha } = req.body;
        
        const funcionario = await Funcionario.findOne({ email, isUser: true });

        if (!funcionario) {
            return res.status(401).json({ authenticated: false, message: 'Usuário não encontrado ou não tem permissão de acesso.' });
        }
        
        const isMatch = await bcrypt.compare(senha, funcionario.senha);

        if (!isMatch) {
            return res.status(401).json({ authenticated: false, message: 'Email ou senha inválidos.' });
        }

        res.json({ 
            authenticated: true,
            id: funcionario._id, 
            nome: funcionario.nome, 
            permissao: funcionario.permissao 
        });

    } catch (error) {
        console.error('Erro durante a autenticação:', error);
        res.status(500).json({ authenticated: false, message: 'Erro interno do servidor.' });
    }
});


// Rota UNIFICADA de Cadastro (Funcionario Ponto OU Usuário com Acesso)
app.post('/api/cadastro', async (req, res) => {
    const { nome, email, senha, cargo, permissao } = req.body;
    
    // Indica que estamos tentando criar um usuário com login
    const isUserRequest = !!email && !!senha; 
    let finalPermissao = isUserRequest ? (permissao || 'funcionario') : 'ponto'; 

    try {
        let funcionarioExistente = null;
        
        // 1. Lógica de Vinculação: Verifica se o e-mail já está cadastrado
        if (email) {
            funcionarioExistente = await Funcionario.findOne({ email });
        }

        // --- Se o registro for para um USUÁRIO COM ACESSO (Login) ---
        if (isUserRequest) {
            
            // 2. Verifica cenário de DUPLICIDADE/VINCULAÇÃO
            if (funcionarioExistente) {
                // Se o funcionário JÁ é um usuário com login, retorna erro de duplicidade
                if (funcionarioExistente.isUser) {
                     return res.status(400).json({ message: 'O e-mail já está em uso por outro usuário com acesso. Não é possível vincular.' });
                }
                
                // Se o funcionário NÃO é um usuário com login (isUser: false), FAZ A VINCULAÇÃO/ATUALIZAÇÃO.
                // Hash da nova senha
                const salt = await bcrypt.genSalt(10);
                const hashedPassword = await bcrypt.hash(senha, salt);
                
                // Lógica de Admin Inicial (força Admin se for o primeiro)
                const adminCount = await Funcionario.countDocuments({ isUser: true, permissao: 'admin' });
                if (adminCount === 0) {
                     finalPermissao = 'admin'; 
                }

                // Atualiza o documento existente
                const atualizado = await Funcionario.findByIdAndUpdate(funcionarioExistente._id, {
                    senha: hashedPassword,
                    isUser: true,
                    permissao: finalPermissao,
                    nome: nome, // Atualiza nome caso tenha sido digitado de forma diferente
                    cargo: cargo
                }, { new: true });

                return res.status(200).json({ 
                    message: `Usuário '${email}' vinculado e atualizado com acesso '${finalPermissao}'!`, 
                    id: atualizado._id 
                });

            } else {
                // 3. SE O E-MAIL NÃO EXISTE: Cria um novo usuário com as credenciais.
                
                // Lógica de Admin Inicial (força Admin se for o primeiro)
                const adminCount = await Funcionario.countDocuments({ isUser: true, permissao: 'admin' });
                if (adminCount === 0) {
                     finalPermissao = 'admin'; 
                }
                
                const novoUsuario = new Funcionario({
                    nome,
                    email,
                    senha, // O hook pre('save') fará o hash
                    cargo,
                    isUser: true,
                    permissao: finalPermissao
                });
                
                await novoUsuario.save();
                return res.status(201).json({ 
                    message: `Novo Usuário '${email}' cadastrado com sucesso!`, 
                    id: novoUsuario._id 
                });
            }

        } else {
            // --- Se o registro for para um FUNCIONÁRIO SÓ PONTO (Sem Login) ---
            
            // 4. Se o e-mail já existir, retorna erro para evitar duplicidade de ponto.
            if (funcionarioExistente) {
                return res.status(400).json({ message: 'O e-mail já está em uso por um colaborador. Não é possível cadastrar duas vezes.' });
            }

            // Cria um novo funcionário só ponto
            const novoPonto = new Funcionario({
                nome,
                email: email || undefined, // Salva o email se houver, mas sem senha/isUser
                cargo,
                isUser: false,
                permissao: 'ponto'
            });

            await novoPonto.save();
            return res.status(201).json({ 
                message: `Funcionário '${nome}' cadastrado apenas para ponto.`, 
                id: novoPonto._id 
            });
        }

    } catch (error) {
        console.error('Erro geral no cadastro:', error);
        res.status(500).json({ message: 'Erro interno do servidor durante o cadastro.', details: error.message });
    }
});


// Rota para buscar TODOS os funcionários (para filtro de relatórios)
app.get('/api/funcionarios-ponto', async (req, res) => {
    try {
        const funcionarios = await Funcionario.find({}, '_id nome cargo isUser').sort({ nome: 1 });
        res.send(funcionarios);
    } catch (error) {
        res.status(500).json({ message: 'Erro ao buscar lista de funcionários.' });
    }
});


// Rota para Registro de Ponto
app.post('/api/ponto', async (req, res) => {
    const { funcionario, tipo, observacao } = req.body;
    
    if (!funcionario || !tipo) {
        return res.status(400).json({ message: 'ID do funcionário e tipo de ponto são obrigatórios.' });
    }
    
    try {
        const novoRegistro = new Ponto({ funcionario, tipo, observacao, dataHora: new Date() });
        await novoRegistro.save();
        res.status(201).json({ message: `Ponto (${tipo}) registrado com sucesso.`, registro: novoRegistro });
    } catch (error) {
        res.status(400).json({ message: 'Falha ao registrar o ponto.', details: error.message });
    }
});

// --- ROTAS DE CONTRATO ---

const contratoSchema = new mongoose.Schema({
    tipo: { type: String, enum: ['Venda', 'Aluguel'], required: true },
    imovelEndereco: { type: String, required: true },
    valorContrato: { type: Number, required: true },
    corretor: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Funcionario', 
        required: true 
    },
    dataFechamento: { type: Date, default: Date.now },
    observacoes: { type: String },
    
    // CAMPOS PARA ARQUIVO BASE64
    arquivo: { type: String }, // String grande para o Base64
    nomeArquivo: { type: String } // Nome original do arquivo
}, { collection: 'contratos' });

const Contrato = mongoose.models.Contrato || mongoose.model('Contrato', contratoSchema);

// Rota para buscar Relatório de Pontos
app.get('/api/relatorio/:funcionarioId', async (req, res) => {
    const { funcionarioId } = req.params;

    try {
        const query = funcionarioId === 'todos' ? {} : { funcionario: funcionarioId };

        const registros = await Ponto.find(query)
            .populate('funcionario', 'nome cargo') 
            .sort({ dataHora: -1 });

        res.send(registros);
    } catch (error) {
        res.status(500).json({ message: 'Erro ao buscar relatórios de ponto.' });
    }
});


module.exports = app;


