#compdef cloudflare-router

# Zsh completion for cloudflare-router

_cloudflare_router() {
  local -a commands
  commands=(
    'account:add:Add a Cloudflare account'
    'account:remove:Remove a Cloudflare account'
    'account:list:List all Cloudflare accounts'
    'zone:discover:Discover zones for an account'
    'zone:add:Add a zone to an account'
    'zone:remove:Remove a zone from an account'
    'add:Add a subdomain mapping'
    'remove:Remove a mapping'
    'list:List all mappings'
    'generate:Generate nginx configs'
    'deploy:Deploy DNS records'
    'status:Show status'
    'dashboard:Start web dashboard'
    'help:Display help'
  )

  _arguments -C \
    '1:command:->command' \
    '*::arg:->args'

  case $state in
    command)
      _describe -t commands 'cloudflare-router commands' commands
      ;;
    args)
      case ${words[1]} in
        account:add)
          _arguments \
            '--name[Account name]:name:' \
            '--email[Cloudflare email]:email:' \
            '--api-key[API key]:key:'
          ;;
        account:remove)
          _arguments '--id[Account ID]:id:'
          ;;
        zone:discover)
          _arguments '--account[Account ID]:id:'
          ;;
        zone:add)
          _arguments \
            '--account[Account ID]:id:' \
            '--zone-id[Zone ID]:id:' \
            '--domain[Domain name]:domain:' \
            '--tunnel-id[Tunnel ID]:id:' \
            '--credentials[Credentials path]:path:'
          ;;
        zone:remove)
          _arguments \
            '--account[Account ID]:id:' \
            '--zone-id[Zone ID]:id:'
          ;;
        add)
          _arguments \
            '--account[Account ID]:id:' \
            '--zone[Zone ID]:id:' \
            '--subdomain[Subdomain]:name:' \
            '--port[Port]:port:' \
            '-d>Description:' \
            '--description[Description]:desc:'
          ;;
        remove)
          _arguments \
            '--account[Account ID]:id:' \
            '--zone[Zone ID]:id:' \
            '--subdomain[Subdomain]:name:'
          ;;
        dashboard)
          _arguments '--port[Port]:port:' '-p[Port]:port:'
          ;;
      esac
      ;;
  esac
}

_cloudflare_router "$@"
