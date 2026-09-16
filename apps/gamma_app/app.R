library(shiny)

library(plotrix)


# Define UI
ui <- fluidPage(
  
  # Application title
  titlePanel("Gamma distribution"),
  
  
  sidebarLayout(

        
    # Sidebar with a slider input
    sidebarPanel(
      p("Gamma distribution plots with a mean ISI of 50 ms"),
      numericInput("k", "shape: k", min = 0, max = 300, value = 1)
    ),
    
    # Show a plot of the generated distribution
    mainPanel(
      plotOutput("gammaPlot"),
      plotOutput("rasterPlot")
    )
  )
)

# Server logic
server <- function(input, output) {
  
  output$gammaPlot <- renderPlot({

    mean_ISI <- 50  # 50 ms mean ISI
  
    scale_theta <- mean_ISI/input$k
    
    x <- seq(0, 200, by = .1)
    y <- dgamma(x, shape = input$k, scale = scale_theta) 
    
    plot(x, y, type = "l", ylab = "Relative frequency", xlab = "ISI duration (ms)")
    
  })
  
  
  output$rasterPlot <- renderPlot({
    
    mean_ISI <- 50  # 50 ms mean ISI
    
    scale_theta <- mean_ISI/input$k
    
    simulated_raster_data <- data.frame()
    
    
    for (i in 1:50) {
      
      rand_data <- rgamma(50, shape = input$k, scale = scale_theta) 
        
      simulated_spike_times <- round(cumsum(rand_data)) 
      simulated_spike_times <- simulated_spike_times[simulated_spike_times <= 1000]
      
      curr_raster_row <- rep(0, 1000)
      curr_raster_row[simulated_spike_times] <- 1
      
      simulated_raster_data <- rbind(simulated_raster_data, curr_raster_row)
      
    }
    
    
    color2D.matplot(1 - simulated_raster_data, 
                    border = NA, xlab = "Time (ms)", 
                    ylab = "Trial")
    

  })
  
  
  
}

# Complete app with UI and server components
shinyApp(ui, server) 
