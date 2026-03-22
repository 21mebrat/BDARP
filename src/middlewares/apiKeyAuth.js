

export const apiKeyAuth =(api_key)=>{
    return async(req,res,next)=>{
        try {
            const incoming_key = req.headers["x-api-key"]
            if(!incoming_key){
                          return res.status(StatusCodes.NOT_ACCEPTABLE).json()  
            }

            if(!api_key){
                          return res.status(StatusCodes.NOT_ACCEPTABLE).json()  
            }
            if(api_key !== incoming_key){
                          return res.status(StatusCodes.NOT_ACCEPTABLE).json()  

            }
            next()
        } catch (_) {
          return res.status(StatusCodes.NOT_ACCEPTABLE).json()  
        }
    }
}