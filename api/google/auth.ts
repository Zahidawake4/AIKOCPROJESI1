import { signState } from "../../lib/crypto.js";
import { requireUid } from "../../lib/firebase.js";
import { buildAuthUrl } from "../../lib/googleAuth.js";
import { route } from "../../lib/http.js";

// İstemci Bearer token ile çağırır, dönen URL'ye yönlenir (tarayıcı yönlendirmesi header taşıyamaz)
export default route(["POST"], async (req, res) => {
  try {
    const uid = await requireUid(req);
    const state = signState(uid);
    const url = buildAuthUrl(state);
    
    return res.status(200).json({ url });
  } catch (error: any) {
    console.error("Google Auth API Hatası Detayı:", error);
    
    const statusCode = error.statusCode || error.status || 500;
    return res.status(statusCode).json({ 
      error: "Google bağlantısı başlatılamadı", 
      message: error.message || String(error) 
    });
  }
});