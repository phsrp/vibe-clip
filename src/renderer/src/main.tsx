import { createRoot } from 'react-dom/client'
import '@fontsource-variable/montserrat'
import './theme/tokens.css'
import './styles/app.css'
import App from './App'

createRoot(document.getElementById('root')!).render(<App />)
